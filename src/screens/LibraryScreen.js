import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  FlatList, StatusBar, Image, RefreshControl, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useFocusEffect } from '@react-navigation/native';
import { getPlaylists, getSongs, deletePlaylist, getStorageInfo } from '../utils/Storage';
import { usePlayer } from '../context/PlayerContext';

const C = {
  bg: '#0d0d14', surface: '#1d1d28', surface2: '#252534',
  violet: '#9060f0', violet2: '#b898ff', rose: '#ff4570',
  teal: '#00c8a8', amber: '#f5a623', text: '#e2d8f5', muted: '#4a4468',
};

export default function LibraryScreen({ navigation }) {
  const {
    currentPl, currentIdx, songs: playerSongs, isPlaying,
    loadPlaylist, playSong, refreshPlaylists, getQueue,
  } = usePlayer();

  const [activeTab,   setActiveTab]   = useState('playlists');
  const [playlists,   setPlaylists]   = useState([]);
  const [songs,       setSongs]       = useState([]);
  const [viewingPl,   setViewingPl]   = useState(null); // playlist currently viewed in Songs tab
  const [refreshing,  setRefreshing]  = useState(false);
  const [storageInfo, setStorageInfo] = useState(null);

  useFocusEffect(
    useCallback(() => {
      loadAll();
    }, [])
  );

  const loadAll = async () => {
    const pls  = await getPlaylists();
    setPlaylists(pls);

    const info = await getStorageInfo();
    setStorageInfo(info);

    // Load songs for currently viewed playlist
    const pl = viewingPl || (pls.length > 0 ? pls[0].name : null);
    if (pl) {
      const s = await getSongs(pl);
      setSongs(s);
      setViewingPl(pl);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await loadAll();
    setRefreshing(false);
  };

  const handleSelectPlaylist = async (plName) => {
    // Load songs for viewing
    setViewingPl(plName);
    const s = await getSongs(plName);
    setSongs(s);
    setActiveTab('songs');
  };

  const handlePlayPlaylist = async (plName) => {
    // BUG 2 FIX: use loadPlaylist from context which handles audio properly
    // Then goBack() to the existing Player screen (not navigate to a new one)
    await loadPlaylist(plName, 0);
    navigation.goBack();
  };

  const handlePlaySong = async (song, idx) => {
    // If this playlist is already loaded in player, just play the song
    if (viewingPl === currentPl) {
      await playSong(idx);
    } else {
      // Load the playlist and play this specific song
      await loadPlaylist(viewingPl, idx);
    }
    navigation.goBack(); // go back to Player (not create new screen)
  };

  const handleDeletePlaylist = (plName) => {
    Alert.alert(
      'Delete Playlist',
      `Delete "${plName}" and all its songs from your phone?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePlaylist(plName);
            await refreshPlaylists();
            if (viewingPl === plName) {
              setSongs([]);
              setViewingPl(null);
            }
            await loadAll();
          },
        },
      ]
    );
  };

  // ── Tab Bar ────────────────────────────────────────────────────────────────
  const TabBar = () => (
    <View style={styles.tabBar}>
      {['playlists', 'songs', 'queue'].map(tab => (
        <TouchableOpacity
          key={tab}
          style={[styles.tab, activeTab === tab && styles.tabActive]}
          onPress={() => setActiveTab(tab)}
        >
          <Text style={[styles.tabText, activeTab === tab && styles.tabTextActive]}>
            {tab === 'playlists' ? '💿 Playlists'
              : tab === 'songs' ? '🎵 Songs' : '⏭ Queue'}
          </Text>
          {activeTab === tab && <View style={styles.tabIndicator} />}
        </TouchableOpacity>
      ))}
    </View>
  );

  // ── Playlists Tab ──────────────────────────────────────────────────────────
  const PlaylistsTab = () => (
    <FlatList
      data={playlists}
      keyExtractor={(_, i) => i.toString()}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.violet} />
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[styles.plCard, item.name === currentPl && styles.plCardActive]}
          onPress={() => handleSelectPlaylist(item.name)}
          onLongPress={() => handleDeletePlaylist(item.name)}
        >
          <View style={styles.plArtWrap}>
            {item.coverArt
              ? <Image source={{ uri: item.coverArt }} style={styles.plArtImg} />
              : <LinearGradient
                  colors={item.name === currentPl ? [C.violet, C.rose] : [C.surface2, C.surface]}
                  style={styles.plArtGrad}>
                  <Text style={{ fontSize: 24 }}>💿</Text>
                </LinearGradient>
            }
            {item.name === currentPl && isPlaying && (
              <View style={styles.plPlayingDot} />
            )}
          </View>
          <View style={styles.plInfo}>
            <Text style={[styles.plName,
              item.name === currentPl && { color: C.violet2 }]} numberOfLines={1}>
              {item.name}
            </Text>
            <Text style={styles.plSub}>
              {item.downloadedTracks || 0} songs
              {item.name === currentPl ? (isPlaying ? ' · ▶ Playing' : ' · ⏸ Paused') : ''}
            </Text>
          </View>
          <View style={styles.plActions}>
            <TouchableOpacity
              style={styles.plPlayBtn}
              onPress={() => handlePlayPlaylist(item.name)}
            >
              <LinearGradient colors={[C.violet, C.rose]} style={styles.plPlayBtnGrad}>
                <Text style={{ color: '#fff', fontSize: 14 }}>▶</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={() => handleDeletePlaylist(item.name)}
            >
              <Text style={styles.deleteBtnText}>🗑</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      )}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>💿</Text>
          <Text style={styles.emptyTitle}>No Playlists Yet</Text>
          <Text style={styles.emptySub}>Tap + to download a Spotify playlist</Text>
          <TouchableOpacity style={styles.emptyBtn} onPress={() => navigation.navigate('Download')}>
            <LinearGradient colors={[C.violet, C.rose]} style={styles.emptyBtnGrad}>
              <Text style={styles.emptyBtnText}>+ Add Playlist</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      }
    />
  );

  // ── Songs Tab ──────────────────────────────────────────────────────────────
  const SongsTab = () => (
    <FlatList
      data={songs}
      keyExtractor={(_, i) => i.toString()}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.violet} />
      }
      ListHeaderComponent={
        viewingPl ? (
          <View style={styles.plHeader}>
            <Text style={styles.plHeaderName}>{viewingPl}</Text>
            <Text style={styles.plHeaderSub}>{songs.length} songs on your phone</Text>
          </View>
        ) : null
      }
      renderItem={({ item, index }) => {
        const isCurrentSong = viewingPl === currentPl && index === currentIdx;
        return (
          <TouchableOpacity
            style={[styles.songRow, isCurrentSong && styles.songRowActive]}
            onPress={() => handlePlaySong(item, index)}
          >
            <Text style={[styles.songNum, isCurrentSong && { color: C.violet }]}>
              {isCurrentSong ? (isPlaying ? '▶' : '⏸') : index + 1}
            </Text>
            <View style={styles.songArtWrap}>
              {item.artPath
                ? <Image source={{ uri: item.artPath }} style={styles.songArtImg} />
                : <LinearGradient
                    colors={isCurrentSong ? [C.violet, C.rose] : [C.surface2, C.surface]}
                    style={styles.songArtGrad}>
                    <Text style={{ fontSize: 16 }}>🎵</Text>
                  </LinearGradient>
              }
            </View>
            <View style={styles.songInfo}>
              <Text style={[styles.songTitle,
                isCurrentSong && { color: C.violet2 }]} numberOfLines={1}>
                {item.title}
              </Text>
              <Text style={styles.songArtist} numberOfLines={1}>{item.artist}</Text>
            </View>
          </TouchableOpacity>
        );
      }}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyIcon}>🎵</Text>
          <Text style={styles.emptyTitle}>No Songs</Text>
          <Text style={styles.emptySub}>
            {playlists.length === 0 ? 'Download a playlist first' : 'Select a playlist'}
          </Text>
        </View>
      }
    />
  );

  // ── Queue Tab ──────────────────────────────────────────────────────────────
  const QueueTab = () => {
    const queue = getQueue();
    return (
      <FlatList
        data={queue}
        keyExtractor={(_, i) => i.toString()}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          playerSongs[currentIdx] ? (
            <View style={styles.nowPlayingCard}>
              <Text style={styles.nowLabel}>NOW PLAYING</Text>
              <View style={styles.nowRow}>
                <View style={styles.songArtWrap}>
                  {playerSongs[currentIdx].artPath
                    ? <Image source={{ uri: playerSongs[currentIdx].artPath }} style={styles.songArtImg} />
                    : <LinearGradient colors={[C.violet, C.rose]} style={styles.songArtGrad}>
                        <Text style={{ fontSize: 16 }}>🎵</Text>
                      </LinearGradient>
                  }
                </View>
                <View style={styles.songInfo}>
                  <Text style={[styles.songTitle, { color: C.violet2 }]} numberOfLines={1}>
                    {playerSongs[currentIdx].title}
                  </Text>
                  <Text style={styles.songArtist}>{playerSongs[currentIdx].artist}</Text>
                </View>
              </View>
            </View>
          ) : null
        }
        renderItem={({ item, index }) => (
          <TouchableOpacity
            style={styles.songRow}
            onPress={() => {
              playSong(item._origIdx);
              navigation.goBack();
            }}
          >
            <Text style={styles.songNum}>{index + 1}</Text>
            <View style={styles.songArtWrap}>
              {item.artPath
                ? <Image source={{ uri: item.artPath }} style={styles.songArtImg} />
                : <LinearGradient colors={[C.surface2, C.surface]} style={styles.songArtGrad}>
                    <Text style={{ fontSize: 16 }}>🎵</Text>
                  </LinearGradient>
              }
            </View>
            <View style={styles.songInfo}>
              <Text style={styles.songTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.songArtist} numberOfLines={1}>{item.artist}</Text>
            </View>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>⏭</Text>
            <Text style={styles.emptyTitle}>Queue Empty</Text>
          </View>
        }
      />
    );
  };


  return (
    <LinearGradient colors={['#1a0828', '#0d0d14']} style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <View>
          <Text style={styles.topTitle}>Library</Text>
          <Text style={styles.topSub}>
            {storageInfo ? `${storageInfo.songs} songs · ${storageInfo.mb} MB` : ''}
          </Text>
        </View>
        <TouchableOpacity
          style={styles.addBtnWrap}
          onPress={() => navigation.navigate('Download')}
        >
          <LinearGradient colors={[C.violet, C.rose]} style={styles.addBtn}>
            <Text style={styles.addBtnText}>+</Text>
          </LinearGradient>
        </TouchableOpacity>
      </View>

      <TabBar />

      <View style={styles.content}>
        {activeTab === 'playlists' && <PlaylistsTab />}
        {activeTab === 'songs'     && <SongsTab />}
        {activeTab === 'queue'     && <QueueTab />}
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 24, color: '#e2d8f5' },
  topTitle: { fontSize: 22, fontWeight: '800', color: '#e2d8f5', textAlign: 'center' },
  topSub: { fontSize: 11, color: '#4a4468', textAlign: 'center', letterSpacing: 1 },
  addBtnWrap: { width: 40, height: 40 },
  addBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#fff', fontSize: 22, fontWeight: '300' },
  tabBar: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: 'rgba(144,96,240,0.15)', paddingHorizontal: 8 },
  tab: { flex: 1, alignItems: 'center', paddingVertical: 12, position: 'relative' },
  tabActive: {},
  tabText: { fontSize: 12, color: '#4a4468', fontWeight: '600' },
  tabTextActive: { color: '#9060f0' },
  tabIndicator: { position: 'absolute', bottom: 0, left: 12, right: 12, height: 2, backgroundColor: '#9060f0', borderRadius: 1 },
  content: { flex: 1 },
  listContent: { paddingBottom: 100, paddingTop: 8 },
  plHeader: { paddingHorizontal: 20, paddingVertical: 12 },
  plHeaderName: { fontSize: 18, fontWeight: '800', color: '#e2d8f5' },
  plHeaderSub: { fontSize: 12, color: '#4a4468', marginTop: 2 },
  plCard: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: 'rgba(144,96,240,0.07)' },
  plCardActive: { backgroundColor: 'rgba(144,96,240,0.07)' },
  plArtWrap: { width: 54, height: 54, borderRadius: 12, overflow: 'hidden', marginRight: 14, position: 'relative' },
  plArtImg: { width: '100%', height: '100%', borderRadius: 12 },
  plArtGrad: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  plPlayingDot: { position: 'absolute', bottom: 4, right: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: '#00c8a8' },
  plInfo: { flex: 1 },
  plName: { fontSize: 15, fontWeight: '700', color: '#e2d8f5', marginBottom: 3 },
  plSub: { fontSize: 11, color: '#4a4468' },
  plActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  plPlayBtn: { width: 34, height: 34, borderRadius: 17, overflow: 'hidden' },
  plPlayBtnGrad: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  deleteBtn: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  deleteBtnText: { fontSize: 18 },
  songRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(144,96,240,0.06)' },
  songRowActive: { backgroundColor: 'rgba(144,96,240,0.08)' },
  songNum: { width: 28, fontSize: 12, color: '#4a4468', textAlign: 'center', marginRight: 8 },
  songArtWrap: { width: 44, height: 44, borderRadius: 8, overflow: 'hidden', marginRight: 12 },
  songArtImg: { width: '100%', height: '100%' },
  songArtGrad: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  songInfo: { flex: 1, marginRight: 8 },
  songTitle: { fontSize: 14, fontWeight: '600', color: '#e2d8f5', marginBottom: 3 },
  songArtist: { fontSize: 12, color: '#4a4468' },
  nowPlayingCard: { marginHorizontal: 20, marginBottom: 12, backgroundColor: 'rgba(144,96,240,0.1)', borderRadius: 16, padding: 14, borderWidth: 1, borderColor: 'rgba(144,96,240,0.2)' },
  nowLabel: { fontSize: 9, fontWeight: '700', color: '#9060f0', letterSpacing: 3, marginBottom: 10 },
  nowRow: { flexDirection: 'row', alignItems: 'center' },
  empty: { alignItems: 'center', paddingTop: 80, paddingHorizontal: 40 },
  emptyIcon: { fontSize: 52, marginBottom: 16, opacity: 0.3 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#252534', marginBottom: 8 },
  emptySub: { fontSize: 13, color: '#4a4468', textAlign: 'center', lineHeight: 20, marginBottom: 24 },
  emptyBtn: { borderRadius: 14, overflow: 'hidden' },
  emptyBtnGrad: { paddingHorizontal: 24, paddingVertical: 14 },
  emptyBtnText: { color: '#fff', fontWeight: '700', fontSize: 14 },
  miniPlayer: { position: 'absolute', bottom: 0, left: 0, right: 0 },
  miniPlayerGrad: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, paddingBottom: 28, borderTopWidth: 1, borderTopColor: 'rgba(144,96,240,0.2)' },
  miniPlayerInfo: { flex: 1, marginLeft: 12 },
  miniPlayerTitle: { fontSize: 14, fontWeight: '600', color: '#e2d8f5', marginBottom: 2 },
  miniPlayerArtist: { fontSize: 12, color: '#4a4468' },
  miniPlayerArrow: { fontSize: 22, color: '#9060f0', paddingHorizontal: 8 },
});