import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useNavigation } from '@react-navigation/native';
import { usePlayer } from '../context/PlayerContext';

const C = {
  bg: '#0d0d14', surface: '#1d1d28', surface2: '#252534',
  violet: '#9060f0', violet2: '#b898ff', rose: '#ff4570',
  teal: '#00c8a8', amber: '#f5a623', text: '#e2d8f5', muted: '#4a4468',
};

export default function MiniPlayer({ isNested }) {
  const navigation = useNavigation();

  const {
    songs, currentIdx, isPlaying, currentSong,
    togglePlay, nextSong, prevSong, shuffle, toggleShuffle
  } = usePlayer();

  if (!songs || songs.length === 0 || !currentSong) return null;

  return (
    <TouchableOpacity
      style={[styles.container, isNested && styles.containerNested]}
      activeOpacity={0.9}
      onPress={() => !isNested && navigation.navigate('Main')}
    >
      <LinearGradient colors={['#252534', '#1d1d28']} style={[styles.gradient, isNested && styles.gradientNested]}>
        <View style={styles.artWrap}>
          {currentSong.artPath ? (
            <Image source={{ uri: currentSong.artPath }} style={styles.artImg} />
          ) : (
            <LinearGradient colors={[C.violet, C.rose]} style={styles.artGrad}>
              <Text style={{ fontSize: 16 }}>🎵</Text>
            </LinearGradient>
          )}
        </View>

        <View style={styles.info}>
          <Text style={styles.title} numberOfLines={1}>{currentSong.title}</Text>
          <Text style={styles.artist} numberOfLines={1}>{currentSong.artist}</Text>
        </View>

        <View style={styles.controls}>
          <TouchableOpacity style={styles.btn} onPress={toggleShuffle}>
            <Text style={[styles.btnText, { fontSize: 16 }, shuffle && { color: C.rose }]}>⇄</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.btn} onPress={prevSong}>
            <Text style={styles.btnText}>⏮</Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.btnPlay} onPress={togglePlay}>
            <Text style={[styles.btnText, { fontSize: 22, color: C.violet2, textAlign: 'center' }, !isPlaying && { paddingLeft: 4 }]}>
              {isPlaying ? '⏸' : '▶'}
            </Text>
          </TouchableOpacity>
          
          <TouchableOpacity style={styles.btn} onPress={nextSong}>
            <Text style={styles.btnText}>⏭</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
  },
  containerNested: {
    position: 'relative',
    elevation: 0,
    shadowOpacity: 0,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    paddingBottom: 24, // extra padding for bottom safe area
    borderTopWidth: 1,
    borderTopColor: 'rgba(144,96,240,0.2)',
  },
  gradientNested: {
    paddingBottom: 10, // override safe area padding when nested
    borderTopWidth: 0,
  },
  artWrap: {
    width: 44,
    height: 44,
    borderRadius: 8,
    overflow: 'hidden',
    marginRight: 10,
  },
  artImg: { width: '100%', height: '100%' },
  artGrad: { width: '100%', height: '100%', alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, marginRight: 6 },
  title: { fontSize: 13, fontWeight: '700', color: '#e2d8f5', marginBottom: 2 },
  artist: { fontSize: 11, color: '#4a4468' },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  btn: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPlay: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnText: {
    fontSize: 18,
    color: '#e2d8f5',
  },
});
