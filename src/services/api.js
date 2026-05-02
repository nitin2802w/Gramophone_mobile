import AsyncStorage from '@react-native-async-storage/async-storage';

// ═══════════════════════════════════════════════════════════════════════════════
//  HARDCODED SERVER URL — permanent AWS EC2 Elastic IP
//  Users never need to enter this. It's always available.
// ═══════════════════════════════════════════════════════════════════════════════
const SERVER_URL = 'http://13.127.22.78:8000';

// ── Get stored server URL and token ───────────────────────────────────────────
export const getServerUrl = async () => {
  return SERVER_URL;
};

export const getToken = async () => {
  return await AsyncStorage.getItem('token') || '';
};

export const getUsername = async () => {
  return await AsyncStorage.getItem('username') || '';
};

// ── Save credentials ───────────────────────────────────────────────────────────
export const saveCredentials = async (username, token) => {
  await AsyncStorage.setItem('username', username);
  await AsyncStorage.setItem('token', token);
};

// ── Clear credentials (logout) ─────────────────────────────────────────────────
export const clearCredentials = async () => {
  await AsyncStorage.removeItem('username');
  await AsyncStorage.removeItem('token');
};

// ── Base API call ──────────────────────────────────────────────────────────────
export const apiCall = async (path, method = 'GET', body = null) => {
  const token = await getToken();

  const opts = {
    method,
    headers: {
      'Content-Type':  'application/json',
      'X-Auth-Token':  token,
    },
  };

  if (body) opts.body = JSON.stringify(body);

  const res  = await fetch(`${SERVER_URL}/api${path}`, opts);
  const data = await res.json().catch(() => ({}));
  // Attach status so callers can check for 409, 401, etc.
  data._status = res.status;
  return data;
};

// ── Register user ──────────────────────────────────────────────────────────────
export const registerUser = async (name) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${SERVER_URL}/api/register`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ name }),
      signal:  controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
};

// ── Check server status ────────────────────────────────────────────────────────
export const checkStatus = async () => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(`${SERVER_URL}/api/status`, {
      method:  'GET',
      headers: { 'Content-Type': 'application/json' },
      signal:  controller.signal,
    });
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
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
  const token = await getToken();
  return `${SERVER_URL}/api/file/${encodeURIComponent(filename)}?token=${token}`;
};

// ── Cleanup server temp files ──────────────────────────────────────────────────
export const cleanupFiles = async () => {
  return await apiCall('/files/cleanup', 'POST');
};

// ── Get my profile ─────────────────────────────────────────────────────────────
export const getMyProfile = async () => {
  return await apiCall('/me');
};