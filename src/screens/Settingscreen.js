import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, TextInput, Alert, ScrollView,
  Switch,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { checkStatus, clearCredentials, cleanupFiles } from '../services/api';

const C = {
  bg:      '#0d0d14',
  surface: '#1d1d28',
  surface2:'#252534',
  violet:  '#9060f0',
  violet2: '#b898ff',
  rose:    '#ff4570',
  teal:    '#00c8a8',
  amber:   '#f5a623',
  text:    '#e2d8f5',
  muted:   '#4a4468',
};

export default function SettingsScreen({ navigation }) {
  const [username,    setUsername]    = useState('');
  const [serverUrl,   setServerUrl]   = useState('');
  const [editUrl,     setEditUrl]     = useState('');
  const [editName,    setEditName]    = useState('');
  const [editing,     setEditing]     = useState(null); // 'url' | 'name' | null
  const [serverOk,    setServerOk]    = useState(null); // null | true | false
  const [checking,    setChecking]    = useState(false);
  const [downloads,   setDownloads]   = useState(0);

  useEffect(() => {
    loadInfo();
  }, []);

  const loadInfo = async () => {
    const name = await AsyncStorage.getItem('username')  || '';
    const url  = await AsyncStorage.getItem('serverUrl') || '';
    setUsername(name);
    setServerUrl(url);
    setEditUrl(url);
    setEditName(name);
  };

  const checkServer = async () => {
    setChecking(true);
    setServerOk(null);
    try {
      const status = await checkStatus(serverUrl);
      setServerOk(status.ok === true);
      setDownloads(status.users || 0);
    } catch (e) {
      setServerOk(false);
    } finally {
      setChecking(false);
    }
  };

  const saveUrl = async () => {
    let url = editUrl.trim();
    if (!url) return;
    if (!url.startsWith('http')) url = 'https://' + url;
    if (url.endsWith('/')) url = url.slice(0, -1);

    try {
      const status = await checkStatus(url);
      if (!status.ok) {
        Alert.alert('Cannot Connect', 'Server did not respond correctly.');
        return;
      }
      await AsyncStorage.setItem('serverUrl', url);
      setServerUrl(url);
      setEditing(null);
      Alert.alert('✅ Saved', 'Server URL updated successfully.');
    } catch (e) {
      Alert.alert('Error', 'Cannot reach server at that URL.');
    }
  };

  const saveName = async () => {
    const name = editName.trim();
    if (!name) return;
    await AsyncStorage.setItem('username', name);
    setUsername(name);
    setEditing(null);
    Alert.alert('✅ Saved', 'Display name updated.');
  };

  const handleLogout = () => {
    Alert.alert(
      'Logout',
      'This will clear your saved server and account info from this device. Your music files will remain.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            await clearCredentials();
            navigation.replace('Welcome');
          },
        },
      ]
    );
  };

  const handleClearCache = () => {
    Alert.alert(
      'Clear Server Cache',
      'This will delete any leftover temporary music files currently stored on the server. Your already downloaded music will not be affected.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Clear Cache',
          style: 'destructive',
          onPress: async () => {
            try {
              const res = await cleanupFiles();
              if (res && res.ok) {
                Alert.alert('✅ Cache Cleared', `Successfully removed ${res.deleted} temporary files from the server.`);
              } else {
                Alert.alert('Error', 'Failed to clear cache.');
              }
            } catch (e) {
              Alert.alert('Error', 'Could not reach server to clear cache.');
            }
          },
        },
      ]
    );
  };

  const Row = ({ icon, label, value, onPress, danger }) => (
    <TouchableOpacity
      style={styles.row}
      onPress={onPress}
      activeOpacity={onPress ? 0.7 : 1}
    >
      <Text style={styles.rowIcon}>{icon}</Text>
      <View style={styles.rowInfo}>
        <Text style={styles.rowLabel}>{label}</Text>
        {value ? (
          <Text style={[styles.rowValue,
            danger && { color: C.rose }]} numberOfLines={1}>
            {value}
          </Text>
        ) : null}
      </View>
      {onPress && (
        <Text style={[styles.rowArrow,
          danger && { color: C.rose }]}>
          {danger ? '→' : '›'}
        </Text>
      )}
    </TouchableOpacity>
  );

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
        <Text style={styles.topTitle}>Settings</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView style={styles.scroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 60 }}>

        {/* Profile Card */}
        <View style={styles.profileCard}>
          <LinearGradient
            colors={[C.violet, C.rose]}
            style={styles.profileAvatar}
          >
            <Text style={styles.profileAvatarText}>
              {username ? username[0].toUpperCase() : '?'}
            </Text>
          </LinearGradient>
          <Text style={styles.profileName}>{username || 'Unknown'}</Text>
          <Text style={styles.profileSub}>
            {serverUrl ? serverUrl.replace('https://', '') : 'No server'}
          </Text>

          {/* Server Status */}
          <TouchableOpacity
            style={[styles.statusBadge,
              serverOk === true  && { backgroundColor: 'rgba(0,200,168,0.15)',
                                      borderColor: C.teal },
              serverOk === false && { backgroundColor: 'rgba(255,69,112,0.15)',
                                      borderColor: C.rose },
            ]}
            onPress={checkServer}
          >
            <View style={[styles.statusDot,
              { backgroundColor:
                  serverOk === true  ? C.teal
                : serverOk === false ? C.rose
                : C.muted }
            ]} />
            <Text style={[styles.statusText,
              { color: serverOk === true  ? C.teal
                      : serverOk === false ? C.rose
                      : C.muted }]}>
              {checking       ? 'Checking...'
               : serverOk === true  ? 'Server Online'
               : serverOk === false ? 'Server Offline'
               : 'Check Connection'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Account Section */}
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.section}>
          <Row
            icon="👤"
            label="Display Name"
            value={username}
            onPress={() => setEditing('name')}
          />
          <View style={styles.divider} />
          <Row
            icon="🌐"
            label="Server URL"
            value={serverUrl.replace('https://', '')}
            onPress={() => setEditing('url')}
          />
        </View>

        {/* Edit Name */}
        {editing === 'name' && (
          <View style={styles.editBox}>
            <Text style={styles.editLabel}>DISPLAY NAME</Text>
            <TextInput
              style={styles.editInput}
              value={editName}
              onChangeText={setEditName}
              autoCapitalize="words"
              autoFocus
              placeholderTextColor={C.muted}
            />
            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.editCancelBtn}
                onPress={() => { setEditing(null); setEditName(username); }}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editSaveBtn}
                onPress={saveName}
              >
                <LinearGradient colors={[C.violet, C.rose]}
                  style={styles.editSaveGrad}>
                  <Text style={styles.editSaveText}>Save</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Edit URL */}
        {editing === 'url' && (
          <View style={styles.editBox}>
            <Text style={styles.editLabel}>SERVER URL</Text>
            <TextInput
              style={styles.editInput}
              value={editUrl}
              onChangeText={setEditUrl}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              autoFocus
              placeholderTextColor={C.muted}
            />
            <View style={styles.editActions}>
              <TouchableOpacity
                style={styles.editCancelBtn}
                onPress={() => { setEditing(null); setEditUrl(serverUrl); }}
              >
                <Text style={styles.editCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.editSaveBtn}
                onPress={saveUrl}
              >
                <LinearGradient colors={[C.violet, C.rose]}
                  style={styles.editSaveGrad}>
                  <Text style={styles.editSaveText}>Save & Test</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Server Section */}
        <Text style={styles.sectionTitle}>SERVER</Text>
        <View style={styles.section}>
          <Row
            icon="📡"
            label="Server Status"
            value={serverOk === true ? 'Online ✅'
                 : serverOk === false ? 'Offline ❌'
                 : 'Tap to check'}
            onPress={checkServer}
          />
          <View style={styles.divider} />
          <Row
            icon="👥"
            label="Total Users"
            value={downloads > 0 ? `${downloads} users` : 'Unknown'}
          />
          <View style={styles.divider} />
          <Row
            icon="🧹"
            label="Clear Server Cache"
            value="Free up disk space on the server"
            onPress={handleClearCache}
          />
        </View>

        {/* About Section */}
        <Text style={styles.sectionTitle}>ABOUT</Text>
        <View style={styles.section}>
          <Row icon="🎵" label="App Name"    value="Gramophone" />
          <View style={styles.divider} />
          <Row icon="📱" label="Version"     value="1.0.0" />
          <View style={styles.divider} />
          <Row icon="💾" label="Storage"     value="On your device" />
        </View>

        {/* Danger Zone */}
        <Text style={styles.sectionTitle}>ACCOUNT</Text>
        <View style={styles.section}>
          <Row
            icon="🚪"
            label="Logout"
            value="Clear saved credentials"
            onPress={handleLogout}
            danger
          />
        </View>

        <Text style={styles.footer}>
          Gramophone v1.0 · Free Music Forever
        </Text>
      </ScrollView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },

  topBar: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 52, paddingHorizontal: 20, paddingBottom: 16,
  },
  backBtn: {
    width: 40, height: 40,
    alignItems: 'center', justifyContent: 'center',
  },
  backBtnText: { fontSize: 24, color: '#e2d8f5' },
  topTitle: { fontSize: 18, fontWeight: '800', color: '#e2d8f5' },

  scroll: { flex: 1 },

  // Profile Card
  profileCard: {
    alignItems: 'center',
    marginHorizontal: 20, marginBottom: 24,
    backgroundColor: 'rgba(144,96,240,0.08)',
    borderRadius: 20, padding: 24,
    borderWidth: 1, borderColor: 'rgba(144,96,240,0.15)',
  },
  profileAvatar: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 12,
  },
  profileAvatarText: { fontSize: 28, fontWeight: '800', color: '#fff' },
  profileName: { fontSize: 20, fontWeight: '700', color: '#e2d8f5', marginBottom: 4 },
  profileSub: { fontSize: 12, color: '#4a4468', marginBottom: 16 },
  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(74,68,104,0.3)',
    backgroundColor: 'rgba(74,68,104,0.1)',
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusText: { fontSize: 12, fontWeight: '600' },

  // Sections
  sectionTitle: {
    fontSize: 10, fontWeight: '700', color: '#9060f0',
    letterSpacing: 3, marginBottom: 8,
    marginHorizontal: 20, marginTop: 24,
  },
  section: {
    marginHorizontal: 20,
    backgroundColor: '#1d1d28',
    borderRadius: 16, overflow: 'hidden',
    borderWidth: 1, borderColor: 'rgba(144,96,240,0.1)',
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
  },
  rowIcon: { fontSize: 20, marginRight: 14 },
  rowInfo: { flex: 1 },
  rowLabel: { fontSize: 14, fontWeight: '600', color: '#e2d8f5', marginBottom: 2 },
  rowValue: { fontSize: 12, color: '#4a4468' },
  rowArrow: { fontSize: 20, color: '#4a4468' },
  divider: {
    height: 1, backgroundColor: 'rgba(144,96,240,0.08)',
    marginLeft: 50,
  },

  // Edit Box
  editBox: {
    marginHorizontal: 20, marginTop: 8,
    backgroundColor: '#1d1d28',
    borderRadius: 16, padding: 16,
    borderWidth: 1, borderColor: 'rgba(144,96,240,0.2)',
  },
  editLabel: {
    fontSize: 10, fontWeight: '700', color: '#9060f0',
    letterSpacing: 3, marginBottom: 10,
  },
  editInput: {
    backgroundColor: '#252534',
    borderRadius: 10, paddingHorizontal: 14,
    paddingVertical: 12, color: '#e2d8f5',
    fontSize: 14, marginBottom: 14,
    borderWidth: 1, borderColor: 'rgba(144,96,240,0.15)',
  },
  editActions: { flexDirection: 'row', gap: 10 },
  editCancelBtn: {
    flex: 1, paddingVertical: 12,
    alignItems: 'center', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(144,96,240,0.2)',
  },
  editCancelText: { color: '#4a4468', fontWeight: '600' },
  editSaveBtn: { flex: 1, borderRadius: 10, overflow: 'hidden' },
  editSaveGrad: { paddingVertical: 12, alignItems: 'center' },
  editSaveText: { color: '#fff', fontWeight: '700' },

  // Footer
  footer: {
    textAlign: 'center', color: '#4a4468',
    fontSize: 11, marginTop: 32, marginBottom: 8,
    letterSpacing: 1,
  },
});