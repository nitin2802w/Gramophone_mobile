/**
 * PlayerContext.js — Global shared player state
 *
 * Fixes Bug 2: screens sharing audio state without creating new screen instances.
 * All screens read from this context. Audio is managed by AudioManager singleton.
 *
 * Usage:
 *   const { songs, currentIdx, isPlaying, playSong, ... } = usePlayer();
 */

import React, { createContext, useContext, useState, useRef, useCallback } from 'react';
import AudioManager from './AudioManager';
import { getPlaylists, getSongs } from '../utils/Storage';

const PlayerContext = createContext(null);

export const PlayerProvider = ({ children }) => {
  const [songs,      setSongs]      = useState([]);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [isPlaying,  setIsPlaying]  = useState(false);
  const [position,   setPosition]   = useState(0);
  const [duration,   setDuration]   = useState(0);
  const [progress,   setProgress]   = useState(0);
  const [currentPl,  setCurrentPl]  = useState(null);
  const [playlists,  setPlaylists]  = useState([]);
  const [shuffle,    setShuffle]     = useState(false);
  const [repeat,     setRepeat]      = useState(false);

  // Shuffle order — pre-computed array of indices
  const shuffleOrder = useRef([]);
  const shufflePos   = useRef(0);

  // ── Playback status callback ─────────────────────────────────────────────
  const onStatus = useCallback((status) => {
    if (!status.isLoaded) return;
    setIsPlaying(status.isPlaying);
    setPosition(status.positionMillis || 0);
    const dur = status.durationMillis || 0;
    setDuration(dur);
    setProgress(dur > 0 ? (status.positionMillis / dur) * 100 : 0);

    if (status.didJustFinish && !status.isLooping) {
      // Use refs to avoid stale closure
      nextSongRef.current?.();
    }
  }, []);

  // Set status callback once on mount
  React.useEffect(() => {
    AudioManager.setStatusCallback(onStatus);
  }, [onStatus]);

  // ── Generate shuffle order ────────────────────────────────────────────────
  const buildShuffleOrder = (count, startIdx = 0) => {
    const arr = Array.from({ length: count }, (_, i) => i);
    // Fisher-Yates shuffle
    for (let i = count - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    // Put startIdx first
    const pos = arr.indexOf(startIdx);
    if (pos > 0) { [arr[0], arr[pos]] = [arr[pos], arr[0]]; }
    return arr;
  };

  // ── Load library ──────────────────────────────────────────────────────────
  const loadLibrary = useCallback(async () => {
    try {
      const pls = await getPlaylists();
      setPlaylists(pls);
      if (songs.length === 0 && pls.length > 0) {
        const s = await getSongs(pls[0].name);
        setSongs(s);
        setCurrentPl(pls[0].name);
      }
    } catch (e) {
      console.log('[PlayerContext] loadLibrary error:', e.message);
    }
  }, [songs.length]);

  // ── Core play function ────────────────────────────────────────────────────
  const playSong = useCallback(async (idx, songList = null) => {
    const list = songList || songs;
    if (!list || idx < 0 || idx >= list.length) return;
    const song = list[idx];
    if (!song?.localPath) return;

    setCurrentIdx(idx);
    if (songList) setSongs(songList);
    // Optimistic UI update: instantly show as playing while the audio loads
    setIsPlaying(true);

    try {
      await AudioManager.play(song.localPath);
    } catch (e) {
      console.log('[PlayerContext] playSong error:', e.message);
    }
  }, [songs]);

  // ── Next / Prev ───────────────────────────────────────────────────────────
  const nextSong = useCallback(async () => {
    const list = songs;
    if (!list.length) return;
    let newIdx;

    if (repeat) {
      newIdx = currentIdx;
    } else if (shuffle) {
      shufflePos.current = (shufflePos.current + 1) % list.length;
      newIdx = shuffleOrder.current[shufflePos.current];
    } else {
      newIdx = (currentIdx + 1) % list.length;
    }
    await playSong(newIdx);
  }, [songs, currentIdx, shuffle, repeat, playSong]);

  const prevSong = useCallback(async () => {
    const list = songs;
    if (!list.length) return;
    let newIdx;

    if (shuffle) {
      shufflePos.current = (shufflePos.current - 1 + list.length) % list.length;
      newIdx = shuffleOrder.current[shufflePos.current];
    } else {
      newIdx = (currentIdx - 1 + list.length) % list.length;
    }
    await playSong(newIdx);
  }, [songs, currentIdx, shuffle, playSong]);

  // Keep nextSong in a ref so the status callback can call it without stale closure
  const nextSongRef = useRef(nextSong);
  React.useEffect(() => { nextSongRef.current = nextSong; }, [nextSong]);

  // ── Toggle shuffle ────────────────────────────────────────────────────────
  const toggleShuffle = useCallback(() => {
    setShuffle(prev => {
      const next = !prev;
      if (next) {
        shuffleOrder.current = buildShuffleOrder(songs.length, currentIdx);
        shufflePos.current   = 0;
      }
      return next;
    });
  }, [songs.length, currentIdx]);

  // ── Toggle repeat ─────────────────────────────────────────────────────────
  const toggleRepeat = useCallback(() => setRepeat(r => !r), []);

  // ── Toggle play/pause ─────────────────────────────────────────────────────
  const togglePlay = useCallback(async () => {
    if (!AudioManager.isLoaded()) {
      if (songs[currentIdx]) await playSong(currentIdx);
      return;
    }
    // Optimistic toggle for instant UI feedback
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    if (nextState) {
      await AudioManager.resume();
    } else {
      await AudioManager.pause();
    }
  }, [songs, currentIdx, playSong, isPlaying]);

  // ── Seek ──────────────────────────────────────────────────────────────────
  const seekTo = useCallback(async (pct) => {
    if (!duration) return;
    await AudioManager.seekTo((pct / 100) * duration);
  }, [duration]);

  // ── Load playlist ─────────────────────────────────────────────────────────
  const loadPlaylist = useCallback(async (plName, startIdx = 0) => {
    try {
      const pls   = await getPlaylists();
      setPlaylists(pls);
      const s = await getSongs(plName);
      setSongs(s);
      setCurrentPl(plName);
      setCurrentIdx(startIdx);
      if (s.length > 0) {
        shuffleOrder.current = buildShuffleOrder(s.length, startIdx);
        shufflePos.current   = 0;
        await playSong(startIdx, s);
      }
    } catch (e) {
      console.log('[PlayerContext] loadPlaylist error:', e.message);
    }
  }, [playSong]);

  // ── Refresh playlists list ────────────────────────────────────────────────
  const refreshPlaylists = useCallback(async () => {
    const pls = await getPlaylists();
    setPlaylists(pls);
  }, []);

  // ── Get queue (songs after current, respecting shuffle) ───────────────────
  const getQueue = useCallback(() => {
    if (shuffle && shuffleOrder.current.length > 0) {
      return shuffleOrder.current
        .slice(shufflePos.current + 1)
        .map(i => ({ ...songs[i], _origIdx: i }));
    }
    return songs.slice(currentIdx + 1).map((s, i) => ({
      ...s,
      _origIdx: currentIdx + 1 + i,
    }));
  }, [songs, currentIdx, shuffle]);

  // Derived next and previous songs for UI 
  let prevSongData = null;
  let nextSongData = null;

  if (songs.length > 0) {
    if (shuffle && shuffleOrder.current.length > 0) {
      const pIdx = shuffleOrder.current[(shufflePos.current - 1 + songs.length) % songs.length];
      const nIdx = shuffleOrder.current[(shufflePos.current + 1) % songs.length];
      // Only show if it's actually ahead/behind in the queue, or wrap around if you want. 
      // For queue limits, shuffle logic wraps around in nextSong/prevSong.
      prevSongData = songs[pIdx];
      nextSongData = songs[nIdx];
    } else {
      prevSongData = songs[currentIdx - 1] || null;
      nextSongData = songs[currentIdx + 1] || null;
    }
  }

  const value = {
    // State
    songs, currentIdx, isPlaying, position, duration, progress,
    currentPl, playlists, shuffle, repeat,
    currentSong: songs[currentIdx] || null,
    prevSongData, nextSongData,
    // Actions
    playSong, nextSong, prevSong,
    togglePlay, toggleShuffle, toggleRepeat, seekTo,
    loadPlaylist, loadLibrary, refreshPlaylists,
    getQueue,
    // Setters (for direct use)
    setSongs, setCurrentIdx, setCurrentPl, setPlaylists,
  };

  return (
    <PlayerContext.Provider value={value}>
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('usePlayer must be used inside PlayerProvider');
  return ctx;
};