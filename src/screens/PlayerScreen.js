import React, { useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, Animated, Dimensions, Image, ScrollView, Easing
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { usePlayer } from '../context/PlayerContext';
import MiniPlayer from '../components/MiniPlayer';

const { width: W } = Dimensions.get('window');
const DISK_SIZE    = W * 0.72;

const C = {
  bg: '#0d0d14', surface: '#1d1d28', surface2: '#252534',
  violet: '#9060f0', violet2: '#b898ff', rose: '#ff4570',
  teal: '#00c8a8', amber: '#f5a623', text: '#e2d8f5', muted: '#4a4468',
};

export default function PlayerScreen({ navigation }) {
  const {
    songs, currentIdx, isPlaying, position, duration, progress,
    currentPl, playlists, shuffle, repeat, currentSong,
    playSong, nextSong, prevSong, togglePlay, toggleShuffle,
    toggleRepeat, seekTo, loadLibrary, loadPlaylist, getQueue,
    prevSongData, nextSongData,
  } = usePlayer();

  // ── Tab state (player / queue / playlist) — local UI only ─────────────────
  const [activeTab, setActiveTab] = React.useState('player');

  // ── Animations ─────────────────────────────────────────────────────────────
  const spinAnim  = useRef(new Animated.Value(0)).current;
  const spinRef   = useRef(null);
  const fadeAnim  = useRef(new Animated.Value(1)).current;

  // ── On focus — reload library without restarting audio ────────────────────
  useFocusEffect(
    useCallback(() => {
      loadLibrary(); // just refreshes playlists list, doesn't touch audio
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start();
    }, [loadLibrary])
  );

  // ── Vinyl spin ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (isPlaying) {
      if (spinRef.current) return;
      spinRef.current = Animated.loop(
        Animated.timing(spinAnim, {
          toValue: 1,
          duration: 3000,
          easing: Easing.linear,
          useNativeDriver: true
        })
      );
      spinRef.current.start();
    } else {
      spinRef.current?.stop();
      spinRef.current = null;
    }
  }, [isPlaying]);

  const spin = spinAnim.interpolate({
    inputRange: [0, 1], outputRange: ['0deg', '360deg'],
  });

  const fmtMs = (ms) => {
    if (!ms) return '0:00';
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // ── Art component ──────────────────────────────────────────────────────────
  const ArtView = ({ song, size }) => {
    if (song?.artPath) {
      return (
        <Image
          source={{ uri: song.artPath }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      );
    }
    return (
      <LinearGradient
        colors={[C.violet, C.rose]}
        style={{ width: size, height: size, borderRadius: size / 2,
                 alignItems: 'center', justifyContent: 'center' }}
      >
        <Text style={{ fontSize: size * 0.35 }}>🎵</Text>
      </LinearGradient>
    );
  };

  // ── Player View ────────────────────────────────────────────────────────────
  const PlayerView = () => (
    <Animated.View style={[styles.playerWrap, { opacity: fadeAnim }]}>

      {/* Adjacent songs */}
      <View style={styles.adjacentWrap}>
        {prevSongData ? (
          <TouchableOpacity onPress={prevSong} style={styles.adjacentCard}>
            <ArtView song={prevSongData} size={52} />
            <Text style={styles.adjacentTitle} numberOfLines={1}>
              {prevSongData.title}
            </Text>
          </TouchableOpacity>
        ) : <View style={{ width: 64 }} />}

        {/* Main Vinyl Disk */}
        <View style={styles.diskWrap}>
          <View style={[styles.diskGlow,
            isPlaying && { backgroundColor: 'rgba(144,96,240,0.18)' }]} />
          <Animated.View style={[styles.disk, { transform: [{ rotate: spin }] }]}>
            <LinearGradient
              colors={['#1a1a2e', '#0d0d18', '#12121f']}
              style={styles.diskGrad}
            >
              <View style={styles.ring1} /><View style={styles.ring2} />
              <View style={styles.ring3} /><View style={styles.ring4} />
              <View style={styles.diskCenter}>
                <ArtView song={currentSong} size={DISK_SIZE * 0.38} />
                <View style={styles.diskHole} />
              </View>
            </LinearGradient>
          </Animated.View>
          {isPlaying && <View style={styles.diskRimGlow} />}
        </View>

        {nextSongData ? (
          <TouchableOpacity onPress={nextSong} style={styles.adjacentCard}>
            <ArtView song={nextSongData} size={52} />
            <Text style={styles.adjacentTitle} numberOfLines={1}>
              {nextSongData.title}
            </Text>
          </TouchableOpacity>
        ) : <View style={{ width: 64 }} />}
      </View>

      {/* Song info */}
      <View style={styles.songInfo}>
        <Text style={styles.songTitle} numberOfLines={1}>
          {currentSong?.title || 'No song playing'}
        </Text>
        <Text style={styles.songArtist} numberOfLines={1}>
          {currentSong?.artist || (playlists.length === 0
            ? 'Download a playlist first' : 'Tap 💿 to select a playlist')}
        </Text>
      </View>

      {/* Progress bar */}
      <View style={styles.progressWrap}>
        <Text style={styles.progTime}>{fmtMs(position)}</Text>
        <TouchableOpacity
          style={styles.progressTrack}
          onPress={(e) => {
            const pct = (e.nativeEvent.locationX / (W - 96)) * 100;
            seekTo(Math.max(0, Math.min(100, pct)));
          }}
          activeOpacity={1}
        >
          <LinearGradient
            colors={[C.rose, C.violet, C.teal]}
            start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${progress}%` }]}
          />
        </TouchableOpacity>
        <Text style={styles.progTime}>{fmtMs(duration)}</Text>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
        <TouchableOpacity style={styles.sideBtn} onPress={toggleShuffle}>
          <Text style={[styles.sideBtnText, shuffle && { color: C.rose }]}>⇄</Text>
          {shuffle && <View style={styles.activeIndicator} />}
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlBtn} onPress={prevSong}>
          <Text style={styles.controlBtnText}>⏮</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.playBtn} onPress={togglePlay}>
          <LinearGradient colors={[C.rose, C.violet]} style={styles.playBtnGrad}>
            <Text style={[styles.playBtnText, !isPlaying && { paddingLeft: 6 }]}>{isPlaying ? '⏸' : '▶'}</Text>
          </LinearGradient>
        </TouchableOpacity>

        <TouchableOpacity style={styles.controlBtn} onPress={nextSong}>
          <Text style={styles.controlBtnText}>⏭</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.sideBtn} onPress={toggleRepeat}>
          <Text style={[styles.sideBtnText, repeat && { color: C.teal }]}>↺</Text>
          {repeat && <View style={[styles.activeIndicator, { backgroundColor: C.teal }]} />}
        </TouchableOpacity>
      </View>
    </Animated.View>
  );

  // ── Queue View ─────────────────────────────────────────────────────────────
  const QueueView = () => {
    const queue = getQueue();
    return (
      <View style={styles.listWrap}>
        <Text style={styles.listTitle}>Up Next</Text>
        <ScrollView>
          {queue.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>
                {shuffle ? 'Shuffle is on — random songs' : 'No more songs in queue'}
              </Text>
            </View>
          ) : queue.map((song, i) => (
            <TouchableOpacity
              key={i}
              style={styles.queueRow}
              onPress={() => playSong(song._origIdx)}
            >
              <Text style={styles.queueNum}>{i + 1}</Text>
              {song.artPath
                ? <Image source={{ uri: song.artPath }} style={styles.queueArt} />
                : <LinearGradient colors={[C.surface2, C.surface]} style={styles.queueArt}>
                    <Text style={{ fontSize: 14, textAlign: 'center' }}>🎵</Text>
                  </LinearGradient>
              }
              <View style={styles.queueInfo}>
                <Text style={styles.queueTitle} numberOfLines={1}>{song.title}</Text>
                <Text style={styles.queueArtist} numberOfLines={1}>{song.artist}</Text>
              </View>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
    );
  };

  // ── Playlist View ──────────────────────────────────────────────────────────
  const PlaylistView = () => (
    <View style={styles.listWrap}>
      <Text style={styles.listTitle}>Your Playlists</Text>
      <ScrollView>
        {playlists.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Text style={styles.emptyText}>No playlists yet{'\n'}Tap + to add one</Text>
          </View>
        ) : playlists.map((pl, i) => (
          <TouchableOpacity
            key={i}
            style={[styles.plRow, pl.name === currentPl && styles.plRowActive]}
            onPress={() => {
              loadPlaylist(pl.name, 0);
              setActiveTab('player');
            }}
          >
            <View style={styles.plArt}>
              {pl.coverArt
                ? <Image source={{ uri: pl.coverArt }}
                    style={{ width: '100%', height: '100%', borderRadius: 10 }} />
                : <LinearGradient
                    colors={pl.name === currentPl ? [C.violet, C.rose] : [C.surface2, C.surface]}
                    style={styles.plArtInner}>
                    <Text style={{ fontSize: 20 }}>💿</Text>
                  </LinearGradient>
              }
            </View>
            <View style={styles.plInfo}>
              <Text style={[styles.plName,
                pl.name === currentPl && { color: C.violet2 }]} numberOfLines={1}>
                {pl.name}
              </Text>
              <Text style={styles.plSub}>
                {pl.downloadedTracks || 0}/{pl.totalTracks || 0} songs
              </Text>
            </View>
            {pl.name === currentPl && (
              <Text style={{ color: C.violet, fontSize: 16 }}>✓</Text>
            )}
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );

  // ── Main Render ────────────────────────────────────────────────────────────
  return (
    <LinearGradient colors={['#1a0828', '#0d0d14', '#0a0a14']} style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.topBtn}
          onPress={() => navigation.navigate('Settings')}
        >
          <Text style={styles.topBtnText}>⚙️</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.topCenter}
          onPress={() => setActiveTab(activeTab === 'player' ? 'playlist' : 'player')}
        >
          <Text style={styles.topTitle} numberOfLines={1}>
            {currentPl || 'GRAMOPHONE'}
          </Text>
          <Text style={styles.topSubTitle}>
            {currentSong ? `${currentIdx + 1} / ${songs.length}` : 'tap to select playlist'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.topBtn}
          onPress={() => navigation.navigate('Download')}
        >
          <LinearGradient colors={[C.violet, C.rose]} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      {/* Content */}
      <View style={styles.content}>
        {activeTab === 'player'   && <PlayerView />}
        {activeTab === 'queue'    && <QueueView />}
        {activeTab === 'playlist' && <PlaylistView />}
      </View>

      {/* Mini Player for secondary tabs */}
      {activeTab !== 'player' && (
        <View style={{ position: 'relative', height: 60 }}>
          <MiniPlayer isNested={true} />
        </View>
      )}

      {/* Bottom Nav */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => navigation.navigate('Library')}
        >
          <Text style={[styles.navIcon, { color: C.muted }]}>🏠</Text>
          <Text style={styles.navLabel}>Library</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.navBtn, styles.navBtnCenter]}
          onPress={() => setActiveTab(activeTab === 'playlist' ? 'player' : 'playlist')}
        >
          <LinearGradient
            colors={activeTab === 'playlist' ? [C.violet, C.rose] : [C.surface2, C.surface]}
            style={styles.navCenterBtn}
          >
            <Text style={styles.navCenterIcon}>💿</Text>
          </LinearGradient>
          <Text style={styles.navLabel} numberOfLines={1}>
            {currentPl ? currentPl.slice(0, 10) : 'Playlist'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.navBtn}
          onPress={() => setActiveTab(activeTab === 'queue' ? 'player' : 'queue')}
        >
          <Text style={[styles.navIcon,
            activeTab === 'queue' && { color: C.violet }]}>⏭</Text>
          <Text style={styles.navLabel}>Queue</Text>
        </TouchableOpacity>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 8 },
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  topBtnText: { fontSize: 22 },
  topCenter: { flex: 1, alignItems: 'center', paddingHorizontal: 8 },
  topTitle: { fontSize: 13, fontWeight: '700', color: '#e2d8f5', letterSpacing: 2, textTransform: 'uppercase' },
  topSubTitle: { fontSize: 10, color: '#4a4468', marginTop: 2 },
  addBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 22, fontWeight: '300' },
  content: { flex: 1 },

  playerWrap: { flex: 1, alignItems: 'center', paddingTop: 8 },
  adjacentWrap: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', width: '100%', paddingHorizontal: 16, marginBottom: 16 },
  adjacentCard: { alignItems: 'center', width: 64, opacity: 0.45 },
  adjacentTitle: { fontSize: 9, color: '#4a4468', marginTop: 4, textAlign: 'center' },

  diskWrap: { width: DISK_SIZE, height: DISK_SIZE, alignItems: 'center', justifyContent: 'center' },
  diskGlow: { position: 'absolute', width: DISK_SIZE + 30, height: DISK_SIZE + 30, borderRadius: (DISK_SIZE + 30) / 2, backgroundColor: 'rgba(144,96,240,0.06)' },
  disk: { width: DISK_SIZE, height: DISK_SIZE, borderRadius: DISK_SIZE / 2, overflow: 'hidden' },
  diskGrad: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: 'rgba(144,96,240,0.18)' },
  ring1: { position: 'absolute', width: DISK_SIZE * 0.95, height: DISK_SIZE * 0.95, borderRadius: DISK_SIZE * 0.475, borderWidth: 0.8, borderColor: 'rgba(144,96,240,0.1)' },
  ring2: { position: 'absolute', width: DISK_SIZE * 0.82, height: DISK_SIZE * 0.82, borderRadius: DISK_SIZE * 0.41, borderWidth: 0.6, borderColor: 'rgba(255,69,112,0.08)' },
  ring3: { position: 'absolute', width: DISK_SIZE * 0.68, height: DISK_SIZE * 0.68, borderRadius: DISK_SIZE * 0.34, borderWidth: 0.6, borderColor: 'rgba(144,96,240,0.08)' },
  ring4: { position: 'absolute', width: DISK_SIZE * 0.55, height: DISK_SIZE * 0.55, borderRadius: DISK_SIZE * 0.275, borderWidth: 0.5, borderColor: 'rgba(0,200,168,0.06)' },
  diskCenter: { width: DISK_SIZE * 0.42, height: DISK_SIZE * 0.42, borderRadius: DISK_SIZE * 0.21, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  diskHole: { position: 'absolute', width: 10, height: 10, borderRadius: 5, backgroundColor: '#0d0d14' },
  diskRimGlow: { position: 'absolute', width: DISK_SIZE + 4, height: DISK_SIZE + 4, borderRadius: (DISK_SIZE + 4) / 2, borderWidth: 1.5, borderColor: 'rgba(144,96,240,0.3)' },

  songInfo: { alignItems: 'center', paddingHorizontal: 40, marginBottom: 12, marginTop: 14 },
  songTitle: { fontSize: 22, fontWeight: '700', color: '#e2d8f5', textAlign: 'center', marginBottom: 6 },
  songArtist: { fontSize: 14, color: '#4a4468', textAlign: 'center' },

  progressWrap: { flexDirection: 'row', alignItems: 'center', width: '100%', paddingHorizontal: 20, marginBottom: 18, gap: 8 },
  progTime: { fontSize: 11, color: '#4a4468', width: 36 },
  progressTrack: { flex: 1, height: 4, backgroundColor: '#252534', borderRadius: 2, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 2 },

  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 20 },
  sideBtn: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  sideBtnText: { fontSize: 22, color: '#4a4468' },
  activeIndicator: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.rose, marginTop: 3 },
  controlBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  controlBtnText: { fontSize: 26, color: '#e2d8f5' },
  playBtn: { width: 70, height: 70, borderRadius: 35, overflow: 'hidden', shadowColor: '#ff4570', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.5, shadowRadius: 16, elevation: 12 },
  playBtnGrad: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  playBtnText: { fontSize: 28, color: '#fff', textAlign: 'center', textAlignVertical: 'center' },

  listWrap: { flex: 1, paddingTop: 8 },
  listTitle: { fontSize: 11, fontWeight: '700', color: '#9060f0', letterSpacing: 3, textTransform: 'uppercase', paddingHorizontal: 20, marginBottom: 12 },
  queueRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(144,96,240,0.07)' },
  queueNum: { width: 28, fontSize: 12, color: '#4a4468', textAlign: 'center', marginRight: 8 },
  queueArt: { width: 42, height: 42, borderRadius: 8, marginRight: 12, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  queueInfo: { flex: 1 },
  queueTitle: { fontSize: 14, fontWeight: '600', color: '#e2d8f5', marginBottom: 3 },
  queueArtist: { fontSize: 12, color: '#4a4468' },

  plRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: 'rgba(144,96,240,0.07)' },
  plRowActive: { backgroundColor: 'rgba(144,96,240,0.07)' },
  plArt: { width: 48, height: 48, borderRadius: 10, marginRight: 14, overflow: 'hidden' },
  plArtInner: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  plInfo: { flex: 1 },
  plName: { fontSize: 15, fontWeight: '600', color: '#e2d8f5', marginBottom: 3 },
  plSub: { fontSize: 11, color: '#4a4468' },

  emptyWrap: { alignItems: 'center', paddingTop: 40 },
  emptyText: { fontSize: 14, color: '#4a4468', textAlign: 'center', lineHeight: 22 },

  bottomNav: { flexDirection: 'row', backgroundColor: '#1d1d28', borderTopWidth: 1, borderTopColor: 'rgba(144,96,240,0.15)', paddingBottom: 24, paddingTop: 10, paddingHorizontal: 20 },
  navBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 4 },
  navBtnCenter: { marginTop: -20 },
  navIcon: { fontSize: 22 },
  navLabel: { fontSize: 10, color: '#4a4468', letterSpacing: 0.5 },
  navCenterBtn: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', shadowColor: '#9060f0', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.4, shadowRadius: 10, elevation: 8 },
  navCenterIcon: { fontSize: 26 },
});