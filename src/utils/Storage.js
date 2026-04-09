/**
 * Storage.js — Local playlist & song manager
 * Fixes Bug 3: duplicate songs via strong deduplication on filename
 */

import * as FileSystem from 'expo-file-system/legacy';

const ROOT           = FileSystem.documentDirectory + 'Gramophone/';
const PLAYLISTS_FILE = ROOT + 'playlists.json';

const safeName = (name) =>
  String(name).replace(/[\/\\:*?"<>|#%&]/g, '_').trim();

const plDir = (playlistName) => ROOT + safeName(playlistName) + '/';

const ensureDir = async (dirPath) => {
  try {
    const info = await FileSystem.getInfoAsync(dirPath);
    if (!info.exists) await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true });
  } catch (_) {
    try { await FileSystem.makeDirectoryAsync(dirPath, { intermediates: true }); } catch (__) {}
  }
};

export const ensureRoot = async () => ensureDir(ROOT);

// ══════════════════════════════════════════════════════════════════════════════
//  PLAYLIST INDEX
// ══════════════════════════════════════════════════════════════════════════════
export const getPlaylists = async () => {
  try {
    await ensureRoot();
    const info = await FileSystem.getInfoAsync(PLAYLISTS_FILE);
    if (!info.exists) return [];
    
    const playlists = JSON.parse(await FileSystem.readAsStringAsync(PLAYLISTS_FILE));
    
    // Dynamically calculate accurate downloaded tracks to fix double counting
    await Promise.all(playlists.map(async (pl) => {
      try {
        const file = plDir(pl.name) + 'songs.json';
        const sInfo = await FileSystem.getInfoAsync(file);
        if (sInfo.exists) {
          const songs = JSON.parse(await FileSystem.readAsStringAsync(file));
          pl.downloadedTracks = songs.length;
        } else {
          pl.downloadedTracks = 0;
        }
      } catch (err) {
        pl.downloadedTracks = 0;
      }
    }));
    
    return playlists;
  } catch (e) {
    console.log('[Storage] getPlaylists:', e.message);
    return [];
  }
};

export const savePlaylists = async (playlists) => {
  await ensureRoot();
  try {
    const tmp = ROOT + '_pl_tmp.json';
    await FileSystem.writeAsStringAsync(tmp, JSON.stringify(playlists, null, 2));
    const exists = await FileSystem.getInfoAsync(PLAYLISTS_FILE);
    if (exists.exists) await FileSystem.deleteAsync(PLAYLISTS_FILE, { idempotent: true });
    await FileSystem.moveAsync({ from: tmp, to: PLAYLISTS_FILE });
  } catch (_) {
    try {
      await FileSystem.writeAsStringAsync(PLAYLISTS_FILE, JSON.stringify(playlists, null, 2));
    } catch (e2) { console.log('[Storage] savePlaylists fallback failed:', e2.message); }
  }
};

export const addPlaylist = async (name, totalTracks) => {
  try {
    const list = await getPlaylists();
    const idx  = list.findIndex(p => p.name === name);
    const entry = {
      name,
      safeName:         safeName(name),
      totalTracks:      totalTracks || 0,
      downloadedTracks: idx >= 0 ? list[idx].downloadedTracks : 0,
      createdAt:        idx >= 0 ? list[idx].createdAt : new Date().toISOString(),
      coverArt:         idx >= 0 ? list[idx].coverArt : null,
    };
    if (idx >= 0) list[idx] = entry; else list.push(entry);
    await savePlaylists(list);
    await ensureDir(plDir(name));
  } catch (e) { console.log('[Storage] addPlaylist:', e.message); }
};

export const deletePlaylist = async (name) => {
  try {
    const dir = plDir(name);
    const info = await FileSystem.getInfoAsync(dir);
    if (info.exists) await FileSystem.deleteAsync(dir, { idempotent: true });
    const list = await getPlaylists();
    await savePlaylists(list.filter(p => p.name !== name));
  } catch (e) { console.log('[Storage] deletePlaylist:', e.message); }
};

export const updatePlaylistCover = async (name, coverPath) => {
  try {
    const list = await getPlaylists();
    const pl   = list.find(p => p.name === name);
    if (pl) { pl.coverArt = coverPath; await savePlaylists(list); }
  } catch (e) { console.log('[Storage] updatePlaylistCover:', e.message); }
};

export const incrementPlaylistDownloaded = async (name) => {
  // Ignored: downloadedTracks is now dynamically computed in getPlaylists()
  // This prevents double-counting if a download is restarted.
};

// ══════════════════════════════════════════════════════════════════════════════
//  SONGS
//  BUG 3 FIX: strong deduplication — check BOTH filename AND title+artist
// ══════════════════════════════════════════════════════════════════════════════
export const getSongs = async (playlistName) => {
  try {
    const file = plDir(playlistName) + 'songs.json';
    const info = await FileSystem.getInfoAsync(file);
    if (!info.exists) return [];
    return JSON.parse(await FileSystem.readAsStringAsync(file));
  } catch (e) {
    console.log('[Storage] getSongs:', e.message);
    return [];
  }
};

export const addSong = async (playlistName, songMeta) => {
  const dir  = plDir(playlistName);
  const file = dir + 'songs.json';

  await ensureDir(dir);

  // Double-check dir is actually a directory
  const dirInfo = await FileSystem.getInfoAsync(dir);
  if (!dirInfo.exists || !dirInfo.isDirectory) {
    await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  }

  let songs = [];
  try {
    const fi = await FileSystem.getInfoAsync(file);
    if (fi.exists) songs = JSON.parse(await FileSystem.readAsStringAsync(file));
  } catch (_) {}

  // BUG 3 FIX: deduplicate by filename (primary) AND by title+artist (secondary)
  const isDuplicate = songs.some(s =>
    s.filename === songMeta.filename ||
    (s.title === songMeta.title && s.artist === songMeta.artist)
  );

  if (!isDuplicate) {
    songs.push(songMeta);
    await FileSystem.writeAsStringAsync(file, JSON.stringify(songs, null, 2));
    console.log('[Storage] Song added:', songMeta.title);
  } else {
    console.log('[Storage] Skipped duplicate:', songMeta.title);
  }
};

// ══════════════════════════════════════════════════════════════════════════════
//  FILE DOWNLOAD — with timeout and partial-file cleanup
// ══════════════════════════════════════════════════════════════════════════════
const DOWNLOAD_TIMEOUT_MS = 90_000;

export const downloadFileToPhone = async (
  serverUrl, token, filename, playlistName, onProgress
) => {
  if (!filename || !serverUrl || !token) return { error: 'Missing parameters' };

  const dir      = plDir(playlistName);
  const destPath = dir + filename;

  try {
    await ensureDir(dir);

    // Already downloaded?
    const existing = await FileSystem.getInfoAsync(destPath);
    if (existing.exists && existing.size > 0) {
      console.log('[Storage] Already exists:', filename);
      return { uri: destPath };
    }

    const url = `${serverUrl}/api/file/${encodeURIComponent(filename)}`;
    console.log('[Storage] Downloading:', filename);

    let downloadObj = null;
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => {
        downloadObj?.pauseAsync?.().catch(() => {});
        reject(new Error(`Download timed out (${DOWNLOAD_TIMEOUT_MS / 1000}s)`));
      }, DOWNLOAD_TIMEOUT_MS)
    );

    const downloadPromise = (async () => {
      downloadObj = FileSystem.createDownloadResumable(
        url, destPath,
        { headers: { 'X-Auth-Token': token } },
        (prog) => {
          if (onProgress && prog.totalBytesExpectedToWrite > 0) {
            onProgress(prog.totalBytesWritten / prog.totalBytesExpectedToWrite);
          }
        }
      );
      return downloadObj.downloadAsync();
    })();

    const result = await Promise.race([downloadPromise, timeoutPromise]);

    if (result && result.status === 200) {
      const check = await FileSystem.getInfoAsync(destPath);
      if (check.exists && check.size > 0) {
        console.log('[Storage] OK:', filename, `(${(check.size / 1024).toFixed(0)} KB)`);
        return { uri: result.uri };
      }
      return { error: 'File written but size is 0' };
    }

    return { error: `HTTP ${result?.status || 'unknown'}` };

  } catch (e) {
    // Clean up partial download
    try {
      const partial = await FileSystem.getInfoAsync(destPath);
      if (partial.exists && partial.size === 0) {
        await FileSystem.deleteAsync(destPath, { idempotent: true });
      }
    } catch (_) {}
    console.log('[Storage] Download error:', filename, e.message);
    return { error: e.message };
  }
};

// ── Helpers ────────────────────────────────────────────────────────────────────
export const getMp3Path = (pl, fn) => plDir(pl) + fn;
export const getJpgPath = (pl, fn) => plDir(pl) + fn;

export const fileExists = async (path) => {
  try {
    const info = await FileSystem.getInfoAsync(path);
    return info.exists && info.size > 0;
  } catch (e) { return false; }
};

export const getStorageInfo = async () => {
  try {
    const playlists = await getPlaylists();
    let bytes = 0, songCount = 0;
    for (const pl of playlists) {
      const songs = await getSongs(pl.name);
      songCount += songs.length;
      for (const song of songs) {
        try {
          const info = await FileSystem.getInfoAsync(getMp3Path(pl.name, song.filename), { size: true });
          if (info.exists) bytes += info.size || 0;
        } catch (_) {}
      }
    }
    return {
      playlists: playlists.length,
      songs:     songCount,
      bytes,
      mb:  (bytes / 1024 / 1024).toFixed(1),
      gb:  (bytes / 1024 / 1024 / 1024).toFixed(2),
    };
  } catch (e) {
    return { playlists: 0, songs: 0, bytes: 0, mb: '0.0', gb: '0.00' };
  }
};

export const formatDuration = (ms) => {
  if (!ms) return '0:00';
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};