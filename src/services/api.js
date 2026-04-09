import AsyncStorage from '@react-native-async-storage/async-storage';

// ── Get stored server URL and token ───────────────────────────────────────────
export const getServerUrl = async () => {
  return await AsyncStorage.getItem('serverUrl') || '';
};

export const getToken = async () => {
  return await AsyncStorage.getItem('token') || '';
};

export const getUsername = async () => {
  return await AsyncStorage.getItem('username') || '';
};

// ── Save credentials ───────────────────────────────────────────────────────────
export const saveCredentials = async (serverUrl, username, token) => {
  await AsyncStorage.setItem('serverUrl', serverUrl);
  await AsyncStorage.setItem('username', username);
  await AsyncStorage.setItem('token', token);
};

// ── Clear credentials (logout) ─────────────────────────────────────────────────
export const clearCredentials = async () => {
  await AsyncStorage.removeItem('serverUrl');
  await AsyncStorage.removeItem('username');
  await AsyncStorage.removeItem('token');
};

// ── Base API call ──────────────────────────────────────────────────────────────
export const apiCall = async (path, method = 'GET', body = null) => {
  const serverUrl = await getServerUrl();
  const token     = await getToken();

  if (!serverUrl) throw new Error('No server URL set');

  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'X-Auth-Token':  token,
    },
  };

  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${serverUrl}/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  // Attach status so callers can check for 409, 401, etc.
  data._status = res.status;
  return data;
};

// ── Register user ──────────────────────────────────────────────────────────────
export const registerUser = async (serverUrl, name) => {
  const res = await fetch(`${serverUrl}/api/register`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ name }),
  });
  return await res.json();
};

// ── Check server status ────────────────────────────────────────────────────────
export const checkStatus = async (serverUrl) => {
  const res = await fetch(`${serverUrl}/api/status`, {
    method:  'GET',
    headers: { 'Content-Type': 'application/json' },
  });
  return await res.json();
};

// ── Get playlists ──────────────────────────────────────────────────────────────
export const getPlaylists = async () => {
  return await apiCall('/playlists');
};

// ── Start download ─────────────────────────────────────────────────────────────
// Pass force=true to reset any stuck server-side session (fixes 409 errors)
export const startDownload = async (spotifyUrl, force = false) => {
  return await apiCall('/download', 'POST', { url: spotifyUrl, force });
};

// ── Cancel / reset a stuck download session ───────────────────────────────────
export const cancelDownload = async () => {
  return await apiCall('/download/cancel', 'POST');
};

// ── Get download status ────────────────────────────────────────────────────────
export const getDownloadStatus = async () => {
  return await apiCall('/download/status');
};

// ── Get ready files ────────────────────────────────────────────────────────────
export const getReadyFiles = async () => {
  return await apiCall('/files/ready');
};

// ── Get file URL (for downloading to phone) ────────────────────────────────────
export const getFileUrl = async (filename) => {
  const serverUrl = await getServerUrl();
  const token     = await getToken();
  return `${serverUrl}/api/file/${encodeURIComponent(filename)}?token=${token}`;
};

// ── Cleanup server temp files ──────────────────────────────────────────────────
export const cleanupFiles = async () => {
  return await apiCall('/files/cleanup', 'POST');
};

// ── Get my profile ─────────────────────────────────────────────────────────────
export const getMyProfile = async () => {
  return await apiCall('/me');
};