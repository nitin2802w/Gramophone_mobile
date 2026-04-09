import React, { useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, StatusBar, ScrollView, Animated, Alert,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useDownload } from '../context/DownloadContext';
import { formatDuration } from '../utils/Storage';

const C = {
  bg: '#0d0d14', surface: '#1d1d28', surface2: '#252534',
  violet: '#9060f0', violet2: '#b898ff', rose: '#ff4570',
  teal: '#00c8a8', amber: '#f5a623', text: '#e2d8f5', muted: '#4a4468',
};

export default function DownloadScreen({ navigation }) {
  // BUG 4 FIX: all state lives in DownloadContext (outside this component)
  // so it persists when user navigates back and returns
  const {
    downloading, logs, trackList, trackStatus,
    plName, done, total, savedCount,
    startDownload, resetDownload, setScrollCallback,
  } = useDownload();

  const [url, setUrl] = React.useState('');
  const scrollRef = useRef(null);

  // Register scroll callback so DownloadContext can auto-scroll logs
  React.useEffect(() => {
    setScrollCallback(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const handleDownload = async () => {
    if (!url.trim()) {
      Alert.alert('Missing URL', 'Paste a Spotify playlist URL'); return;
    }
    if (!url.includes('spotify.com/playlist')) {
      Alert.alert('Invalid URL',
        'Use a Spotify playlist URL\nhttps://open.spotify.com/playlist/...'); return;
    }
    await startDownload(url.trim());
  };

  const trackIcon = (i) => {
    const s = trackStatus[i];
    if (s === 'done')          return '✅';
    if (s === 'downloading')   return '⬇️';
    if (s === 'saving')        return '💾';
    if (s === 'queued')        return '🕐';
    if (s === 'server')        return '🔄';
    if (s === 'server_failed') return '⚠️';
    if (s === 'failed')        return '❌';
    return '⏳';
  };

  const trackColor = (i) => {
    const s = trackStatus[i];
    if (s === 'done')         return C.teal;
    if (s === 'downloading')  return C.amber;
    if (s === 'queued')       return C.violet2;
    if (s === 'server')       return '#888';
    if (s === 'server_failed')return C.amber;
    if (s === 'failed')       return C.rose;
    return C.muted;
  };

  const logColor = (t) => ({ success: C.teal, error: C.rose }[t] || C.text);
  const savedPct = total > 0 ? Math.round((savedCount / total) * 100) : 0;

  return (
    <LinearGradient colors={['#1a0828', '#0d0d14']} style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      {/* Top Bar */}
      <View style={styles.topBar}>
        <TouchableOpacity
          style={styles.backBtn}
          onPress={() => navigation.goBack()}
        >
          <Text style={styles.backBtnText}>←</Text>
        </TouchableOpacity>
        <Text style={styles.topTitle}>Add Playlist</Text>
        {downloading ? (
          <View style={styles.liveIndicator}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        ) : <View style={{ width: 48 }} />}
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* URL Input — show when idle AND when downloading (so user sees what's happening) */}
        {!done && (
          <View style={styles.inputSection}>
            {!downloading && (
              <>
                <Text style={styles.sectionLabel}>SPOTIFY PLAYLIST URL</Text>
                <View style={styles.inputWrap}>
                  <Text style={styles.inputIcon}>🎵</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="https://open.spotify.com/playlist/..."
                    placeholderTextColor={C.muted}
                    value={url}
                    onChangeText={setUrl}
                    autoCapitalize="none"
                    autoCorrect={false}
                    keyboardType="url"
                  />
                  {url.length > 0 && (
                    <TouchableOpacity onPress={() => setUrl('')}>
                      <Text style={{ color: C.muted, fontSize: 18 }}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <Text style={styles.hint}>
                  Spotify → Playlist → Share → Copy link → Paste above
                </Text>
                <Text style={styles.noticeText}>
                  * Playlist must be public. Maximum 100 songs will be downloaded.
                </Text>
                <TouchableOpacity
                  style={styles.downloadBtn}
                  onPress={handleDownload}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={[C.violet, C.rose]}
                    start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                    style={styles.downloadBtnGrad}
                  >
                    <Text style={styles.downloadBtnText}>⬇  Download Playlist</Text>
                  </LinearGradient>
                </TouchableOpacity>
              </>
            )}

            {/* Progress card — visible even if user navigated away and came back */}
            {downloading && (
              <View style={styles.downloadingSection}>
                <View style={styles.downloadingHeader}>
                  <View style={styles.downloadingDot} />
                  <View style={styles.downloadingInfo}>
                    <Text style={styles.downloadingTitle} numberOfLines={1}>
                      {plName || 'Connecting...'}
                    </Text>
                    <Text style={styles.downloadingProgress}>
                      {savedCount > 0
                        ? `${savedCount} / ${total} saved to phone`
                        : total > 0
                        ? `0 / ${total} — downloading...`
                        : 'Fetching playlist info...'}
                    </Text>
                  </View>
                </View>
                {total > 0 && (
                  <View style={styles.progressGroup}>
                    <View style={styles.progressWrap}>
                      <View style={styles.progressTrack}>
                        <LinearGradient
                          colors={[C.violet, C.teal]}
                          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
                          style={[styles.progressFill, { width: `${savedPct}%` }]}
                        />
                      </View>
                      <Text style={styles.progressPct}>{savedPct}%</Text>
                    </View>
                  </View>
                )}
              </View>
            )}
          </View>
        )}

        {/* Done */}
        {done && (
          <View style={styles.doneSection}>
            <Text style={styles.doneIcon}>🎉</Text>
            <Text style={styles.doneTitle}>Download Complete!</Text>
            <Text style={styles.doneSub}>{savedCount} songs saved to your phone</Text>
            <TouchableOpacity
              style={styles.doneBtn}
              onPress={() => navigation.navigate('Main')}
            >
              <LinearGradient colors={[C.teal, C.violet]} style={styles.doneBtnGrad}>
                <Text style={styles.doneBtnText}>▶  Play Now</Text>
              </LinearGradient>
            </TouchableOpacity>
            <TouchableOpacity style={styles.doneBtn2} onPress={() => { setUrl(''); resetDownload(); }}>
              <Text style={styles.doneBtn2Text}>+ Add Another Playlist</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Track list */}
        {trackList.length > 0 && (
          <View style={styles.trackSection}>
            <Text style={styles.sectionLabel}>TRACKS · {trackList.length} songs</Text>
            {trackList.map((track, i) => (
              <View key={i} style={styles.trackRow}>
                <Text style={styles.trackIcon}>{trackIcon(i)}</Text>
                <View style={styles.trackInfo}>
                  <Text style={[styles.trackTitle, { color: trackColor(i) }]} numberOfLines={1}>
                    {track.title}
                  </Text>
                  <Text style={styles.trackArtist} numberOfLines={1}>{track.artist}</Text>
                </View>
                <Text style={styles.trackDur}>{formatDuration(track.dur_ms)}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Log output */}
        {logs.length > 0 && (
          <View style={styles.logSection}>
            <Text style={styles.sectionLabel}>LOG</Text>
            <View style={styles.logBox}>
              <ScrollView
                ref={scrollRef}
                style={styles.logScroll}
                showsVerticalScrollIndicator={false}
              >
                {logs.map((log, i) => (
                  <Text key={i} style={[styles.logText, { color: logColor(log.type) }]}>
                    {log.text}
                  </Text>
                ))}
              </ScrollView>
            </View>
          </View>
        )}
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: 52, paddingHorizontal: 20, paddingBottom: 16 },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  backBtnText: { fontSize: 24, color: '#e2d8f5' },
  topTitle: { fontSize: 18, fontWeight: '800', color: '#e2d8f5' },
  liveIndicator: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, backgroundColor: 'rgba(144,96,240,0.15)', borderRadius: 20 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#9060f0' },
  liveText: { fontSize: 11, color: '#9060f0', fontWeight: '700' },
  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 60 },
  sectionLabel: { fontSize: 10, fontWeight: '700', color: '#9060f0', letterSpacing: 3, marginBottom: 10, marginTop: 20 },
  inputSection: { marginTop: 8 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#1d1d28', borderRadius: 14, borderWidth: 1, borderColor: 'rgba(144,96,240,0.25)', paddingHorizontal: 16, height: 56, marginBottom: 12 },
  inputIcon: { fontSize: 18, marginRight: 12 },
  input: { flex: 1, color: '#e2d8f5', fontSize: 14 },
  hint: { fontSize: 12, color: '#4a4468', lineHeight: 18, marginBottom: 8 },
  noticeText: { fontSize: 11, color: '#f5a623', lineHeight: 16, marginBottom: 24 },
  downloadBtn: { borderRadius: 16, overflow: 'hidden', shadowColor: '#9060f0', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.4, shadowRadius: 16, elevation: 10 },
  downloadBtnGrad: { height: 58, alignItems: 'center', justifyContent: 'center' },
  downloadBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  downloadingSection: { marginTop: 20, backgroundColor: 'rgba(144,96,240,0.08)', borderRadius: 16, padding: 16, borderWidth: 1, borderColor: 'rgba(144,96,240,0.2)' },
  downloadingHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  downloadingDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: '#9060f0', marginRight: 12 },
  downloadingInfo: { flex: 1 },
  downloadingTitle: { fontSize: 16, fontWeight: '700', color: '#e2d8f5', marginBottom: 3 },
  downloadingProgress: { fontSize: 12, color: '#4a4468' },
  progressGroup: { gap: 6 },
  progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressTrack: { flex: 1, height: 5, backgroundColor: '#252534', borderRadius: 3, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3 },
  progressPct: { fontSize: 12, color: '#9060f0', fontWeight: '700', width: 36 },
  doneSection: { alignItems: 'center', paddingVertical: 32 },
  doneIcon: { fontSize: 56, marginBottom: 16 },
  doneTitle: { fontSize: 24, fontWeight: '800', color: '#e2d8f5', marginBottom: 8 },
  doneSub: { fontSize: 14, color: '#4a4468', marginBottom: 28 },
  doneBtn: { width: '100%', borderRadius: 16, overflow: 'hidden', marginBottom: 12 },
  doneBtnGrad: { height: 54, alignItems: 'center', justifyContent: 'center' },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  doneBtn2: { paddingVertical: 14 },
  doneBtn2Text: { color: '#9060f0', fontSize: 14, fontWeight: '600' },
  trackSection: { marginTop: 8 },
  trackRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(144,96,240,0.06)' },
  trackIcon: { fontSize: 16, marginRight: 12, width: 24, textAlign: 'center' },
  trackInfo: { flex: 1, marginRight: 8 },
  trackTitle: { fontSize: 13, fontWeight: '600', marginBottom: 2 },
  trackArtist: { fontSize: 11, color: '#4a4468' },
  trackDur: { fontSize: 11, color: '#4a4468' },
  logSection: { marginTop: 8 },
  logBox: { backgroundColor: '#0a0a12', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(144,96,240,0.1)' },
  logScroll: { maxHeight: 160 },
  logText: { fontSize: 11, lineHeight: 18 },
});