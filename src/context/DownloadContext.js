/**
 * DownloadContext.js — Global download state
 *
 * Fixes Bug 4: download progress is lost when user navigates back.
 * State lives here (outside the screen component) so it persists
 * no matter which screen is mounted.
 */

import React, { createContext, useContext, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getServerUrl } from '../services/api';
import {
  addPlaylist, addSong, downloadFileToPhone,
  incrementPlaylistDownloaded, updatePlaylistCover,
  ensureRoot, getSongs,
} from '../utils/Storage';

const DownloadContext = createContext(null);

const MAX_RETRIES    = 3;
const RETRY_DELAY_MS = 2000;
const POLL_INTERVAL  = 600;

export const DownloadProvider = ({ children }) => {
  const [downloading,  setDownloading]  = useState(false);
  const [logs,         setLogs]         = useState([]);
  const [trackList,    setTrackList]    = useState([]);
  const [trackStatus,  setTrackStatus]  = useState({});
  const [plName,       setPlName]       = useState('');
  const [done,         setDone]         = useState(false);
  const [total,        setTotal]        = useState(0);
  const [savedCount,   setSavedCount]   = useState(0);

  // Refs
  const serverUrlRef   = useRef('');
  const tokenRef       = useRef('');
  const plNameRef      = useRef('');
  const isDoneRef      = useRef(false);
  const pollTimerRef   = useRef(null);
  const lastEventIdRef = useRef(0);
  const downloadQueue  = useRef([]);
  const isProcessingQ  = useRef(false);
  const savedCountRef  = useRef(0);
  const scrollCbRef    = useRef(null); // callback to scroll log

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  const addLog = (text, type = 'log') => {
    setLogs(prev => [...prev, { text, type }]);
    setTimeout(() => scrollCbRef.current?.(), 80);
  };

  const setStatus = (idx, status) => {
    setTrackStatus(prev => ({ ...prev, [idx]: status }));
  };

  // ── Reset state for new download ─────────────────────────────────────────
  const resetState = () => {
    setDownloading(true); setLogs([]); setTrackList([]);
    setTrackStatus({}); setPlName(''); setDone(false);
    setSavedCount(0); setTotal(0);
    isDoneRef.current    = false;
    lastEventIdRef.current = 0;
    downloadQueue.current  = [];
    isProcessingQ.current  = false;
    savedCountRef.current  = 0;
  };

  // ── Start download ────────────────────────────────────────────────────────
  const startDownload = async (url) => {
    resetState();
    await ensureRoot();

    const serverUrl = await getServerUrl();
    const token     = await AsyncStorage.getItem('token');
    serverUrlRef.current = serverUrl;
    tokenRef.current     = token;

    addLog('🔗 Connecting to server...');

    // Tell server to start
    let res, data;
    try {
      res  = await fetch(`${serverUrl}/api/download`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
        body:    JSON.stringify({ url }),
      });
      data = await res.json();
    } catch (e) {
      addLog(`❌ Connection failed: ${e.message}`, 'error');
      setDownloading(false); return;
    }

    if (data.error && res.status === 409) {
      addLog('[!] Restarting stuck session...', 'error');
      res  = await fetch(`${serverUrl}/api/download`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'X-Auth-Token': token },
        body:    JSON.stringify({ url, force: true }),
      });
      data = await res.json();
    }

    if (data.error) {
      addLog(`❌ ${data.error}`, 'error');
      setDownloading(false); return;
    }

    addLog('✅ Download started on server');
    pollEvents();
  };

  // ── Poll SSE (non-blocking) ───────────────────────────────────────────────
  const pollEvents = async () => {
    if (isDoneRef.current) return;

    const serverUrl = serverUrlRef.current;
    const token     = tokenRef.current;
    const fromId    = lastEventIdRef.current;

    try {
      const controller = new AbortController();
      const tid = setTimeout(() => controller.abort(), 25000);

      const res = await fetch(`${serverUrl}/api/download/stream?token=${token}`, {
        headers: {
          'X-Auth-Token':  token,
          'Last-Event-ID': String(fromId),
          'Cache-Control': 'no-cache',
        },
        signal: controller.signal,
      });
      clearTimeout(tid);

      const text  = await res.text();
      let   maxId = fromId;

      for (const line of text.split('\n')) {
        if (line.startsWith('id: ')) {
          const n = parseInt(line.slice(4));
          if (!isNaN(n) && n > maxId) maxId = n;
        }
        if (line.startsWith('data: ')) {
          try { handleEventFast(JSON.parse(line.slice(6))); }
          catch (_) {}
        }
      }
      lastEventIdRef.current = maxId;

    } catch (err) {
      if (err.name !== 'AbortError') {
        addLog(`[Net] Reconnecting... (${err.message.slice(0, 40)})`);
        await sleep(2000);
      }
    }

    if (!isDoneRef.current) {
      pollTimerRef.current = setTimeout(pollEvents, POLL_INTERVAL);
    }
  };

  // ── Handle SSE event (SYNCHRONOUS — no file I/O) ─────────────────────────
  const handleEventFast = (data) => {
    switch (data.type) {
      case 'log':
        if (data.msg && !data.msg.includes('[WARN]')) addLog(data.msg);
        break;
      case 'playlist_info':
        plNameRef.current = data.playlist_name;
        setPlName(data.playlist_name);
        setTotal(data.total);
        setTrackList(data.tracks || []);
        addLog(`📋 ${data.playlist_name} — ${data.total} tracks`);
        addPlaylist(data.playlist_name, data.total).catch(() => {});
        break;
      case 'track_start':
        setStatus(data.index - 1, 'server');
        break;
      case 'song_ready':
        setStatus(data.index, 'queued');
        downloadQueue.current.push({
          mp3: data.mp3, jpg: data.jpg,
          title: data.title, artist: data.artist,
          playlist: data.playlist || plNameRef.current,
          index: data.index, total: data.total, retries: 0,
        });
        if (!isProcessingQ.current) processDownloadQueue();
        break;
      case 'track_failed':
        setStatus(data.index, 'server_failed');
        addLog(`⚠️ Server failed: ${data.title}`, 'error');
        break;
      case 'playlist_done':
        addLog(`\n🎵 Server finished: ${data.total} songs ready`);
        setTimeout(finishUp, 1000);
        break;
      case 'done':
        isDoneRef.current = true;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        break;
      case 'error':
        addLog(`❌ Server error: ${data.msg}`, 'error');
        isDoneRef.current = true;
        if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
        setDownloading(false);
        break;
    }
  };

  // ── Process download queue (independent of SSE) ───────────────────────────
  const processDownloadQueue = async () => {
    if (isProcessingQ.current) return;
    isProcessingQ.current = true;

    while (true) {
      const item = downloadQueue.current.shift();
      if (!item) {
        await sleep(400);
        if (downloadQueue.current.length === 0) break;
        continue;
      }
      await downloadSong(item);
    }
    isProcessingQ.current = false;
  };

  const downloadSong = async (item) => {
    const { mp3, jpg, title, artist, playlist, index } = item;
    const serverUrl = serverUrlRef.current;
    const token     = tokenRef.current;

    setStatus(index, 'downloading');

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        addLog(`⬇ [${index + 1}] ${title}${attempt > 1 ? ` (retry ${attempt})` : ''}`);

        const mp3Res = await downloadFileToPhone(serverUrl, token, mp3, playlist);
        if (!mp3Res?.uri) {
          if (attempt < MAX_RETRIES) {
            addLog(`  ⚠ Retry ${attempt}/${MAX_RETRIES}: ${mp3Res?.error || 'failed'}`, 'error');
            await sleep(RETRY_DELAY_MS * attempt);
            continue;
          }
          setStatus(index, 'failed');
          addLog(`  ❌ Failed: ${title}`, 'error');
          return;
        }

        let jpgPath = null;
        if (jpg) {
          const jpgRes = await downloadFileToPhone(serverUrl, token, jpg, playlist);
          if (jpgRes?.uri) jpgPath = jpgRes.uri;
        }

        await addSong(playlist, {
          title, artist, filename: mp3, jpgFile: jpg || null,
          localPath: mp3Res.uri, artPath: jpgPath, index, duration: 0,
        });

        if (index === 0 && jpgPath) {
          await updatePlaylistCover(playlist, jpgPath).catch(() => {});
        }
        await incrementPlaylistDownloaded(playlist).catch(() => {});

        savedCountRef.current += 1;
        setSavedCount(savedCountRef.current);
        setStatus(index, 'done');
        addLog(`  ✅ Saved: ${title}`, 'success');
        return;

      } catch (err) {
        if (attempt < MAX_RETRIES) {
          addLog(`  ⚠ Error: ${err.message.slice(0, 50)}`, 'error');
          await sleep(RETRY_DELAY_MS * attempt);
        } else {
          setStatus(index, 'failed');
          addLog(`  ❌ Failed: ${title}`, 'error');
        }
      }
    }
  };

  // ── Finish up — check for missed songs ────────────────────────────────────
  const finishUp = async () => {
    addLog('⏳ Waiting for downloads to finish...');

    const maxWait = Date.now() + 10 * 60 * 1000;
    while ((downloadQueue.current.length > 0 || isProcessingQ.current) && Date.now() < maxWait) {
      await sleep(500);
    }

    // FIX BUG 3: check local storage first before re-downloading
    try {
      const serverUrl = serverUrlRef.current;
      const token     = tokenRef.current;
      const playlist  = plNameRef.current;

      addLog('🔍 Checking for missed songs...');
      const res  = await fetch(`${serverUrl}/api/files/ready?token=${token}`, {
        headers: { 'X-Auth-Token': token },
      });
      const data = await res.json();

      if (data.ready && data.ready.length > 0) {
        // FIX: Only download songs NOT already in local storage
        const localSongs = await getSongs(playlist);
        const localFiles = new Set(localSongs.map(s => s.filename));
        const missed     = data.ready.filter(item => !localFiles.has(item.mp3));

        if (missed.length > 0) {
          addLog(`📦 Found ${missed.length} missed songs — downloading...`);
          for (const item of missed) {
            downloadQueue.current.push({
              mp3: item.mp3, jpg: item.jpg,
              title: item.title, artist: item.artist,
              playlist: item.playlist || playlist,
              index: item.index, total: item.total, retries: 0,
            });
          }
          if (!isProcessingQ.current) await processDownloadQueue();
          while (downloadQueue.current.length > 0 || isProcessingQ.current) {
            await sleep(500);
          }
        } else {
          addLog('✓ No missed songs');
        }
      } else {
        addLog('✓ All songs accounted for');
      }
    } catch (e) {
      addLog(`[Check] ${e.message}`, 'error');
    }

    // Cleanup server temp files
    try {
      const serverUrl = serverUrlRef.current;
      const token     = tokenRef.current;
      await fetch(`${serverUrl}/api/files/cleanup?token=${token}`, {
        method: 'POST', headers: { 'X-Auth-Token': token },
      });
    } catch (_) {}

    isDoneRef.current = true;
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setDownloading(false);
    setDone(true);
    addLog(`\n🎉 All done! ${savedCountRef.current} songs saved to phone.`, 'success');
  };

  const resetDownload = () => {
    setLogs([]); setTrackList([]); setTrackStatus({});
    setSavedCount(0); setTotal(0); setPlName('');
    setDone(false); setDownloading(false);
    isDoneRef.current = false;
  };

  return (
    <DownloadContext.Provider value={{
      // State
      downloading, logs, trackList, trackStatus,
      plName, done, total, savedCount,
      // Actions
      startDownload, resetDownload,
      setScrollCallback: (cb) => { scrollCbRef.current = cb; },
    }}>
      {children}
    </DownloadContext.Provider>
  );
};

export const useDownload = () => {
  const ctx = useContext(DownloadContext);
  if (!ctx) throw new Error('useDownload must be inside DownloadProvider');
  return ctx;
};