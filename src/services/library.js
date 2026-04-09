/**
 * Local Library Manager
 * Saves downloaded songs to device storage and maintains a metadata index
 * in AsyncStorage so the app works fully offline after download.
 */
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

const SONGS_DIR   = FileSystem.documentDirectory + 'gramophone/songs/';
const LIBRARY_KEY = 'gramophone_library';   // AsyncStorage key

// ── Ensure base directory exists ───────────────────────────────────────────────
export const ensureDirs = async () => {
  const info = await FileSystem.getInfoAsync(SONGS_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(SONGS_DIR, { intermediates: true });
  }
};

// ── Load full library from AsyncStorage ───────────────────────────────────────
// Returns: { [playlistName]: [{ title, artist, dur_ms, localMp3, localJpg }] }
export const loadLibrary = async () => {
  try {
    const raw = await AsyncStorage.getItem(LIBRARY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
};

// ── Save library back to AsyncStorage ─────────────────────────────────────────
const saveLibrary = async (lib) => {
  await AsyncStorage.setItem(LIBRARY_KEY, JSON.stringify(lib));
};

// ── Get playlist names ─────────────────────────────────────────────────────────
export const getPlaylists = async () => {
  const lib = await loadLibrary();
  return Object.keys(lib).map(name => ({
    name,
    count: lib[name].length,
  }));
};

// ── Get songs in a playlist ────────────────────────────────────────────────────
export const getSongs = async (playlistName) => {
  const lib = await loadLibrary();
  return lib[playlistName] || [];
};

// ── Add a song to the library after download ──────────────────────────────────
export const addSongToLibrary = async (playlistName, songMeta) => {
  const lib = await loadLibrary();
  if (!lib[playlistName]) lib[playlistName] = [];

  // Avoid duplicates
  const exists = lib[playlistName].some(s => s.title === songMeta.title);
  if (!exists) {
    lib[playlistName].push(songMeta);
  }
  await saveLibrary(lib);
};

// ── Remove a playlist and its files ───────────────────────────────────────────
export const deletePlaylist = async (playlistName) => {
  const lib = await loadLibrary();
  const songs = lib[playlistName] || [];

  // Delete all local files
  for (const song of songs) {
    if (song.localMp3) {
      const info = await FileSystem.getInfoAsync(song.localMp3);
      if (info.exists) await FileSystem.deleteAsync(song.localMp3, { idempotent: true });
    }
    if (song.localJpg) {
      const info = await FileSystem.getInfoAsync(song.localJpg);
      if (info.exists) await FileSystem.deleteAsync(song.localJpg, { idempotent: true });
    }
  }

  // Remove playlist dir
  const playlistDir = SONGS_DIR + playlistName + '/';
  const dirInfo = await FileSystem.getInfoAsync(playlistDir);
  if (dirInfo.exists) {
    await FileSystem.deleteAsync(playlistDir, { idempotent: true });
  }

  delete lib[playlistName];
  await saveLibrary(lib);
};

// ── Download a single file from server to phone ───────────────────────────────
// Returns local file URI or null on failure
export const downloadFile = async (serverUrl, token, filename, destPath) => {
  const url = `${serverUrl}/api/file/${encodeURIComponent(filename)}?token=${token}`;
  try {
    const result = await FileSystem.downloadAsync(url, destPath);
    if (result.status === 200) {
      return destPath;
    }
    console.warn(`[Library] Download failed (${result.status}): ${filename}`);
    return null;
  } catch (e) {
    console.warn(`[Library] Download error: ${filename}`, e);
    return null;
  }
};

// ── Full song pull: download MP3 + JPG, save metadata ────────────────────────
// Call this when you receive a "song_ready" SSE event
export const pullSong = async (serverUrl, token, songEvent) => {
  await ensureDirs();

  const { mp3, jpg, title, artist, playlist, dur_ms } = songEvent;
  const playlistDir = SONGS_DIR + playlist + '/';

  // Ensure playlist folder exists
  const dirInfo = await FileSystem.getInfoAsync(playlistDir);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(playlistDir, { intermediates: true });
  }

  // Download MP3
  const mp3Dest    = playlistDir + mp3;
  const localMp3   = await downloadFile(serverUrl, token, mp3, mp3Dest);

  // Download JPG (optional — don't fail if missing)
  let localJpg = null;
  if (jpg) {
    const jpgDest = playlistDir + jpg;
    localJpg = await downloadFile(serverUrl, token, jpg, jpgDest);
  }

  if (!localMp3) {
    return null;   // MP3 failed — skip
  }

  const songMeta = {
    title,
    artist,
    playlist,
    dur_ms:   dur_ms || 0,
    localMp3,
    localJpg,
  };

  await addSongToLibrary(playlist, songMeta);
  return songMeta;
};
