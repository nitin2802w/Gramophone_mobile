/**
 * AudioManager.js — Singleton audio player
 *
 * Fixes Bug 1: double audio playback when switching playlists.
 * Only ONE sound ever plays at a time. Any new play() call
 * automatically stops and unloads whatever was playing before.
 */

import { Audio } from 'expo-av';

class AudioManager {
  constructor() {
    this._sound       = null;
    this._statusCb    = null;
    this._currentUri  = null;
    this._initialized = false;
  }

  async init() {
    if (this._initialized) return;
    await Audio.setAudioModeAsync({
      allowsRecordingIOS:         false,
      staysActiveInBackground:    true,
      shouldDuckAndroid:          true,
      playThroughEarpieceAndroid: false,
    });
    this._initialized = true;
  }

  setStatusCallback(cb) {
    this._statusCb = cb;
    // Attach to existing sound if already playing
    if (this._sound) {
      this._sound.setOnPlaybackStatusUpdate(cb);
    }
  }

  async play(uri) {
    if (!uri) return;
    await this.init();

    // Stop and unload any existing sound FIRST
    await this.unload();

    try {
      const { sound } = await Audio.Sound.createAsync(
        { uri },
        { shouldPlay: true, volume: 1.0 },
        this._statusCb
      );
      this._sound      = sound;
      this._currentUri = uri;
    } catch (e) {
      console.log('[AudioManager] play error:', e.message);
      throw e;
    }
  }

  async togglePlayPause() {
    if (!this._sound) return;
    try {
      const status = await this._sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await this._sound.pauseAsync();
      } else {
        await this._sound.playAsync();
      }
    } catch (e) {
      console.log('[AudioManager] togglePlayPause error:', e.message);
    }
  }

  async pause() {
    try { await this._sound?.pauseAsync(); } catch (_) {}
  }

  async resume() {
    try { await this._sound?.playAsync(); } catch (_) {}
  }

  async seekTo(ms) {
    try { await this._sound?.setPositionAsync(ms); } catch (_) {}
  }

  async unload() {
    if (this._sound) {
      try {
        await this._sound.stopAsync();
        await this._sound.unloadAsync();
      } catch (_) {}
      this._sound      = null;
      this._currentUri = null;
    }
  }

  isLoaded() {
    return this._sound !== null;
  }

  getCurrentUri() {
    return this._currentUri;
  }
}

// Export a single shared instance
export default new AudioManager();