# 🎵 Gramophone — Personal Music Server & Player

> **Stream your Spotify playlists to your phone. No subscriptions. No accounts. Just music.**

Gramophone is a self-hosted music system with two parts: a **Python backend server** (`app.py`) that scrapes Spotify playlists and downloads them as MP3s via YouTube, and a **React Native mobile app** (built with Expo) that connects to your server, receives songs in real time, stores them locally, and plays them back — fully offline after download.

---

## Table of Contents

- [How It Works — Overview](#how-it-works--overview)
- [Architecture](#architecture)
- [Backend: `app.py`](#backend-apppy)
  - [Auto Package Installer](#auto-package-installer)
  - [User Management](#user-management)
  - [Authentication](#authentication)
  - [Download Pipeline](#download-pipeline)
  - [SSE Event Stream](#sse-event-stream)
  - [File Endpoints](#file-endpoints)
  - [API Reference](#api-reference)
- [Mobile App](#mobile-app)
  - [Entry Point: `App.js`](#entry-point-appjs)
  - [Screens](#screens)
  - [Contexts (Global State)](#contexts-global-state)
  - [Services](#services)
  - [Utils](#utils)
  - [Components](#components)
- [Project File Structure](#project-file-structure)
- [Technology Stack](#technology-stack)
- [Setup & Running](#setup--running)
- [Building the APK](#building-the-apk)

---

## How It Works — Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S FLOW                              │
│                                                                 │
│  1. Open the app → Enter name + server URL → Connect           │
│  2. Go to Download tab → Paste a Spotify playlist URL          │
│  3. Server scrapes Spotify, downloads audio from YouTube       │
│  4. Phone gets real-time progress via SSE polling              │
│  5. Each MP3 is pulled to the phone as it becomes ready        │
│  6. Songs are saved locally — play fully offline forever       │
└─────────────────────────────────────────────────────────────────┘

  ┌──────────────┐     HTTP / SSE     ┌──────────────────────────┐
  │  React Native│ ◄─────────────────► │  Python Flask Server     │
  │  Mobile App  │                    │  (app.py)                │
  └──────────────┘                    └──────────────────────────┘
         │                                      │
   Stores MP3/JPG                    Downloads from YouTube
   locally on device                 via yt-dlp + ffmpeg
```

---

## Architecture

The project is split into two independent but tightly coupled systems:

| Layer | Tech | Location |
|-------|------|----------|
| **Backend Server** | Python + Flask | `app.py` |
| **Mobile Frontend** | React Native + Expo SDK 54 | `src/` |
| **Local Storage** | `expo-file-system` + JSON files | Device filesystem |
| **Audio Playback** | `expo-av` | `AudioManager.js` |
| **Navigation** | React Navigation v7 | `App.js` |
| **State Management** | React Context API | `src/context/` |

---

## Backend: `app.py`

This is a single-file Flask server (~900 lines) that handles everything on the server side. It is designed to run on **Termux (Android)**, **Linux**, or **Windows** without any configuration.

### Auto Package Installer

At startup, `app.py` automatically inspects whether each required dependency is importable:

```python
REQUIRED = {
    "flask":           "flask",
    "flask_cors":      "flask-cors",
    "mutagen":         "mutagen",
    "pandas":          "pandas",
    "yt_dlp":          "yt-dlp",
    "requests":        "requests",
    "spotify_scraper": "spotify-scraper",
}
```

If any package is missing, it runs `pip install --upgrade <packages>` automatically before importing anything. This means you can run `python app.py` on a bare Python installation and it will self-configure. On failure, it writes a crash report to `error.log` and exits with a clear message.

### User Management

Users are stored in `users.json` in the project root. There is no manual registration UI — users register themselves from the mobile app.

| Function | Description |
|----------|-------------|
| `register_user(name)` | Creates a new user or returns the existing token for reinstalls. Sanitizes name, resolves collisions (e.g. `john`, `john_2`). Generates a 32-char random token. |
| `get_user_by_token(token)` | Reverse-lookup: finds a username from a token. Used by every authenticated route. |
| `increment_downloads(username)` | Increments the download counter for a user each time a song is successfully sent. |
| `_load_users()` / `_save_users()` | Thread-safe read/write using a `threading.Lock`. Writes atomically via a temp file + `os.replace`. |

**`users.json` structure:**
```json
{
  "nitin": {
    "token": "aBcDeFgH...",
    "created": "2026-04-03",
    "downloads": 47
  }
}
```

Each registered user also gets a private temp folder: `temp/<username>/`.

### Authentication

Every protected endpoint uses the `@auth_required` decorator:

```python
def auth_required(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token    = get_token_from_request()   # X-Auth-Token header or ?token= query
        username = get_user_by_token(token)
        if not username:
            return jsonify({"error": "Unauthorized"}), 401
        return fn(*args, username=username, **kwargs)
    return wrapper
```

The token is accepted either in:
- `X-Auth-Token` HTTP header *(preferred)*
- `?token=` URL query parameter *(fallback for file downloads)*

### Download Pipeline

When the phone POSTs a Spotify URL to `/api/download`, the server launches a **background daemon thread** and immediately returns `{"ok": true}`. This is the core workflow inside `_download_thread()`:

```
┌──────────────────────────────────────────────────────┐
│                  _download_thread()                  │
│                                                      │
│  1. fetch_playlist_tracks(url)                       │
│     └─ Uses spotify-scraper to scrape the embed page │
│        No Spotify API key needed. Gets up to 100     │
│        tracks: title, artists, album art URLs,       │
│        duration.                                     │
│                                                      │
│  2. Emit "playlist_info" event via SSE               │
│     └─ Phone receives complete track list upfront    │
│        before any downloads begin.                   │
│                                                      │
│  3. For each track:                                  │
│     a. Emit "track_start" event                      │
│     b. Download album art (from Spotify or YouTube   │
│        thumbnail as fallback) → saves as .jpg        │
│     c. Download audio via yt-dlp (searches YouTube   │
│        for "Song Artist official audio") → .mp3      │
│        at 192 kbps via ffmpeg                        │
│     d. Emit "song_ready" event with filename info    │
│     e. Phone calls GET /api/file/<filename> to pull  │
│                                                      │
│  4. Emit "playlist_done" then "done"                 │
└──────────────────────────────────────────────────────┘
```

**Key design decisions:**
- **No permanent storage on server.** Files live in `temp/<username>/` only while the phone fetches them. After the session, the phone calls `/api/files/cleanup` to delete everything.
- **ffmpeg auto-detection.** Checks for `ffmpeg` on PATH first (Termux default), then falls back to `C:\ffmpeg\bin` or `C:\Program Files\ffmpeg\bin` on Windows.
- **Force flag.** If the user sends `{"force": true}`, any stuck previous session is reset without returning a 409 error.

### SSE Event Stream

The mobile app polls `/api/download/stream` to receive live download progress. The server uses a **condition-variable-based event queue** per user (not a true SSE persistent connection, for broad HTTP client compatibility):

```python
# Per-user state stored in memory:
_user_states[username] = {
    "downloading":   bool,
    "current_track": str,
    "progress":      int,
    "total":         int,
    "playlist_name": str,
    "ready_files":   list,
    "events":        list,          # append-only event log
    "condition":     threading.Condition(),
}
```

Each call to `/api/download/stream` passes a `Last-Event-ID` header. The server returns all events from that ID onwards, then the client immediately re-polls. Events are numbered with integer IDs so the client can resume exactly where it left off after a network drop.

**Event types emitted:**

| Event Type | When | Payload |
|------------|------|---------|
| `log` | Any server log message | `{msg}` |
| `playlist_info` | After Spotify scrape | `{playlist_name, total, tracks[]}` |
| `track_start` | Before downloading each song | `{index, total, title, artist}` |
| `song_ready` | After MP3 is saved to temp | `{mp3, jpg, title, artist, playlist, index, total}` |
| `track_failed` | If a song couldn't be downloaded | `{title, reason}` |
| `playlist_done` | All songs processed | `{name, total, failed}` |
| `done` | Stream is closing | — |
| `ping` | Keepalive (no new events) | — |

### File Endpoints

Three ways to transfer a file from server to phone:

| Endpoint | Use Case |
|----------|----------|
| `GET /api/file/<filename>` | Full file download (primary method). Security: path traversal prevention using `os.path.abspath` check. |
| `GET /api/file/base64/<filename>` | Returns the file content Base64-encoded in a JSON field. Use when direct binary transfer is problematic. |
| `GET /api/file/chunk/<filename>?offset=&length=` | Chunked transfer with `X-File-Size`, `X-Chunk-Offset`, `X-Chunk-Length` headers. Allows resumable or range-based downloads. |

### API Reference

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `GET` | `/` | ✗ | Health check / welcome page |
| `GET` | `/api/status` | ✗ | Server version and user count |
| `POST` | `/api/register` | ✗ | Register / login: `{name}` → `{username, token, new_user}` |
| `GET` | `/api/me` | ✓ | Your profile (username, created, download count) |
| `GET` | `/api/users` | Admin | List all users (requires `ADMIN_TOKEN` env var) |
| `POST` | `/api/download` | ✓ | Start downloading: `{url, force?}` |
| `POST` | `/api/download/cancel` | ✓ | Reset a stuck download session |
| `GET` | `/api/download/stream` | ✓ | Poll SSE events (pass `Last-Event-ID`) |
| `GET` | `/api/download/status` | ✓ | Current download progress (polling alternative) |
| `GET` | `/api/file/<filename>` | ✓ | Download a file (binary) |
| `GET` | `/api/file/base64/<filename>` | ✓ | Download a file (Base64 JSON) |
| `GET` | `/api/file/chunk/<filename>` | ✓ | Download a file chunk (`?offset=&length=`) |
| `GET` | `/api/files/ready` | ✓ | List files available for pickup |
| `POST` | `/api/files/cleanup` | ✓ | Delete all server-side temp files for your user |
| `GET` | `/api/server/storage` | Admin | Temp dir file count and size in MB |
| `GET` | `/api/error-log` | ✗ | Read the last crash log |

---

## Mobile App

A React Native app built with **Expo SDK 54**, using React Context for global state, `expo-av` for audio, and `expo-file-system` for local storage.

### Entry Point: `App.js`

`App.js` is the root of the application. It:

1. **Wraps the entire app** in two global context providers:
   - `<PlayerProvider>` — manages audio playback state globally
   - `<DownloadProvider>` — manages download state globally (persists across screen navigation)

2. **Sets up the navigation stack** with 5 screens:

| Screen | Route Name | Description |
|--------|-----------|-------------|
| `WelcomeScreen` | `Welcome` | Login / server connect screen |
| `PlayerScreen` | `Main` | Full-screen music player |
| `LibraryScreen` | `Library` | Browse downloaded playlists |
| `DownloadScreen` | `Download` | Download Spotify playlists |
| `SettingsScreen` | `Settings` | Server info, storage, logout |

3. **Tracks the current route** using `NavigationContainer`'s `onStateChange` callback. This is used to conditionally show the `MiniPlayer` — it is hidden on `Welcome` and `Main` screens (since `Main` is the full player), but floats over all other screens (`Library`, `Download`, `Settings`).

```js
// MiniPlayer is shown on all screens EXCEPT Welcome and Main
{currentRoute !== 'Welcome' && currentRoute !== 'Main' && <MiniPlayer />}
```

4. **Global dark theme** — background color `#0d0d14` is applied via `cardStyle` on all screens so there is never a white flash during transitions.

---

### Screens

#### `WelcomeScreen.js`
The first screen shown to new users. On load, it immediately checks `AsyncStorage` for a saved `serverUrl`, `token`, and `username`. If found, it skips to `PlayerScreen` (the main app). Otherwise, it shows the login form.

**UI:** Animated vinyl disc logo (rotates + pulses), name input, server URL input, "Connect →" button with a violet-to-rose gradient.

**Flow on connect:**
1. Validates input
2. Calls `GET /api/status` to verify the server is reachable
3. Calls `POST /api/register` with the user's name
4. Saves `serverUrl`, `username`, `token` to `AsyncStorage`
5. Navigates to `Main`

#### `PlayerScreen.js`
The full-screen music player. Shows album art (cover image), song title, artist, playlist name, playback progress bar, and controls: shuffle, previous, play/pause, next, repeat. Also shows a scrollable queue of upcoming songs.

Reads all state from `usePlayer()` context and calls its actions (`togglePlay`, `nextSong`, `seekTo`, etc.).

#### `LibraryScreen.js`
Displays all locally downloaded playlists as cards with cover art, song count, and total track count. Tapping a playlist loads it into the player via `loadPlaylist()` and navigates to `PlayerScreen`. Also supports deleting a playlist (removes all local files and metadata).

#### `DownloadScreen.js`
The download management screen. Contains a text input for the Spotify playlist URL and a "Download" button that calls `startDownload()` from `DownloadContext`.

While a download is in progress, shows:
- A live track list with per-song status icons (⏳ queued on server, ⬇ downloading to phone, ✅ saved, ❌ failed)
- A scrollable log of events with timestamps

After completion, shows a summary and a "Download Another" button that resets the state.

#### `SettingsScreen.js`
Shows the connected server URL, username, download statistics, and storage usage. Provides a "Logout" button that clears all credentials from `AsyncStorage` and returns to `WelcomeScreen`, and a "Clear All Data" button that deletes all local playlists and files.

---

### Contexts (Global State)

#### `PlayerContext.js` + `AudioManager.js`

`PlayerContext` is a React context that provides all playback state and controls to every component in the app. It uses `AudioManager` (a singleton) for actual audio operations.

**Why a singleton?** The `AudioManager` class ensures only one `expo-av` Sound object exists at a time. Any call to `.play(uri)` first calls `.unload()` on the previous sound — this prevents the classic bug of two songs playing simultaneously when switching playlists.

**State exposed by `PlayerContext`:**

| State | Type | Description |
|-------|------|-------------|
| `songs` | `Song[]` | The current song list (active playlist) |
| `currentIdx` | `number` | Index of the currently playing song |
| `isPlaying` | `boolean` | Whether audio is currently playing |
| `position` | `number` | Current playback position in milliseconds |
| `duration` | `number` | Total duration of current song in milliseconds |
| `progress` | `number` | `position / duration * 100` (0–100) |
| `currentPl` | `string` | Name of the currently loaded playlist |
| `playlists` | `Playlist[]` | All locally stored playlists |
| `shuffle` | `boolean` | Shuffle mode on/off |
| `repeat` | `boolean` | Repeat mode on/off |
| `currentSong` | `Song` | Shorthand for `songs[currentIdx]` |

**Actions exposed:**

| Action | Description |
|--------|-------------|
| `playSong(idx, songList?)` | Load and play song at index. Optionally replaces the song list. |
| `nextSong()` | Play next song (respects shuffle order, wraps around). |
| `prevSong()` | Play previous song (respects shuffle history). |
| `togglePlay()` | Pause/resume current song. |
| `toggleShuffle()` | Toggle shuffle. Builds a new Fisher-Yates shuffle order starting at the current song. |
| `toggleRepeat()` | Toggle repeat (loops current song on finish). |
| `seekTo(pct)` | Seek to a percentage (0–100) of the track duration. |
| `loadPlaylist(name, startIdx?)` | Load a full playlist by name from local storage and begin playback. |
| `loadLibrary()` | Load all playlists from disk into context state. |
| `getQueue()` | Get the list of upcoming songs (after current), respecting shuffle order. |

**Playback status callback:** `AudioManager.setStatusCallback(onStatus)` is called once on mount. The `onStatus` function updates `isPlaying`, `position`, `duration`, and `progress` on every playback status update from expo-av. When `didJustFinish` is true, it calls `nextSong()` via a ref (to avoid stale closures).

---

#### `DownloadContext.js`

Manages the entire download lifecycle. State lives here (outside `DownloadScreen`) so progress is not lost when the user navigates to another tab mid-download.

**State exposed:**

| State | Description |
|-------|-------------|
| `downloading` | `true` while a download is in progress |
| `logs` | Array of `{text, type}` log lines for display |
| `trackList` | Full track list received from the server at the start |
| `trackStatus` | `{[trackIndex]: 'server'|'queued'|'downloading'|'done'|'failed'}` |
| `plName` | Name of the playlist being downloaded |
| `done` | `true` when the download session is fully complete |
| `total` | Total number of tracks in the playlist |
| `savedCount` | Number of songs successfully saved to phone so far |

**How `startDownload(url)` works:**

1. **Resets state** and calls `ensureRoot()` to ensure the local filesystem directory exists.
2. **Reads server URL and token** from `AsyncStorage`.
3. **POSTs to `/api/download`** to start the server-side download. If a 409 (already downloading) is returned, automatically retries with `{force: true}` to reset the stuck session.
4. **Starts `pollEvents()`** — a recursive async loop that polls `/api/download/stream` every 600ms, passing the last received event ID so no events are missed. Uses `AbortController` with a 25-second timeout per request.

**Event handling (`handleEventFast`):**
Events from the SSE stream are handled synchronously:
- `playlist_info` → Renders the full track list, creates the playlist entry in local storage.
- `track_start` → Updates the track status to `'server'` (downloading on server).
- `song_ready` → Adds the song to the download queue. Starts `processDownloadQueue()` if not already running.
- `playlist_done` → Calls `finishUp()` after 1 second.
- `done` → Stops polling.
- `error` → Shows error, stops everything.

**Download queue processing (`processDownloadQueue` → `downloadSong`):**
The queue runs independently of the SSE poll. For each song:
1. Calls `downloadFileToPhone(serverUrl, token, mp3, playlist)` from `Storage.js`.
2. If the MP3 download succeeds, downloads the JPG cover art.
3. Calls `addSong(playlist, {...metadata})` to save to the local filesystem index.
4. Updates the first song's cover art as the playlist cover.
5. Retries up to 3 times with exponential backoff (`2s`, `4s`, `6s`) on failure.

**`finishUp()`:** After `playlist_done`, waits for the download queue to drain, then calls `GET /api/files/ready` to check for any songs missed (e.g., due to a brief network drop). Any missed songs not already in local storage are re-downloaded. Finally calls `POST /api/files/cleanup` to delete all server temp files.

---

### Services

#### `src/services/api.js`
A thin HTTP client layer. Reads `serverUrl` and `token` from `AsyncStorage` and wraps `fetch` calls.

| Export | Description |
|--------|-------------|
| `getServerUrl()` | Read server URL from AsyncStorage |
| `getToken()` | Read auth token from AsyncStorage |
| `getUsername()` | Read username from AsyncStorage |
| `saveCredentials(url, user, token)` | Save all three to AsyncStorage |
| `clearCredentials()` | Remove all three (logout) |
| `apiCall(path, method, body)` | Generic authenticated API call. Always sends `X-Auth-Token`. Attaches `._status` to the response for checking HTTP codes. |
| `registerUser(serverUrl, name)` | No-auth POST to `/api/register` |
| `checkStatus(serverUrl)` | No-auth GET to `/api/status` |
| `startDownload(spotifyUrl, force?)` | POST to `/api/download` |
| `cancelDownload()` | POST to `/api/download/cancel` |
| `getDownloadStatus()` | GET `/api/download/status` |
| `getReadyFiles()` | GET `/api/files/ready` |
| `cleanupFiles()` | POST `/api/files/cleanup` |
| `getMyProfile()` | GET `/api/me` |

#### `src/services/library.js`
An older library management service (predates `Storage.js`). Provides `loadLibrary`, `getPlaylists`, `getSongs`, `addSongToLibrary`, `deletePlaylist`, `downloadFile`, and `pullSong`. The primary storage layer is now `Storage.js` — `library.js` is kept for legacy compatibility.

---

### Utils

#### `src/utils/Storage.js`
The primary local data layer. All playlists and songs are stored as JSON files in the app's document directory under `Gramophone/`:

```
<documentDirectory>/
  Gramophone/
    playlists.json           ← Index of all playlists
    <PlaylistName>/
      songs.json             ← Index of songs in this playlist
      Song Title - Artist.mp3
      Song Title - Artist.jpg
```

**Key functions:**

| Function | Description |
|----------|-------------|
| `ensureRoot()` | Creates `Gramophone/` directory if missing |
| `getPlaylists()` | Reads `playlists.json`. Dynamically recalculates `downloadedTracks` from each playlist's `songs.json` to prevent double-counting. |
| `savePlaylists(list)` | Atomic write: writes to `_pl_tmp.json` then moves to `playlists.json`. |
| `addPlaylist(name, total)` | Upserts a playlist entry. Preserves existing cover art and creation date. |
| `deletePlaylist(name)` | Deletes the playlist directory (all MP3s and JPGs) and removes from index. |
| `updatePlaylistCover(name, path)` | Sets the cover art path for a playlist in the index. |
| `getSongs(playlistName)` | Reads `<playlist>/songs.json`. |
| `addSong(playlistName, songMeta)` | Appends a song to `songs.json`. **Deduplicates** by both `filename` AND `title+artist` to prevent duplicate entries from re-downloads. |
| `downloadFileToPhone(serverUrl, token, filename, playlist, onProgress?)` | Downloads a file from the server to the phone's local filesystem using `FileSystem.createDownloadResumable`. Checks if the file already exists (skip if > 0 bytes). Has a **90-second timeout** that pauses the download object and rejects the promise. Cleans up 0-byte partial files on failure. |
| `getStorageInfo()` | Calculates total storage used across all playlists (count, MB, GB). |
| `formatDuration(ms)` | Formats milliseconds as `M:SS`. |

---

### Components

#### `src/components/MiniPlayer.js`
A persistent mini player bar that floats at the bottom of Library, Download, and Settings screens. It reads state from `usePlayer()` and renders:
- Album art thumbnail (or gradient placeholder)
- Song title and artist (single line, truncated)
- Shuffle toggle, previous, play/pause, next buttons

Tapping the bar navigates to `PlayerScreen` (the full player). Renders `null` if no song is loaded.

---

## Project File Structure

```
gramophone/
├── app.py                          # Python Flask backend server
├── App.js                          # React Native app root: navigation + providers
├── index.js                        # Expo entry point (registers App component)
├── app.json                        # Expo config (name, icon, permissions, EAS project ID)
├── package.json                    # JS dependencies
├── eas.json                        # Expo Application Services build config
│
├── src/
│   ├── screens/
│   │   ├── WelcomeScreen.js        # Login / server connect
│   │   ├── PlayerScreen.js         # Full-screen music player
│   │   ├── LibraryScreen.js        # Browse downloaded playlists
│   │   ├── Downloadscreen.js       # Download Spotify playlists
│   │   └── Settingscreen.js        # Settings, storage, logout
│   │
│   ├── context/
│   │   ├── PlayerContext.js        # Global playback state & controls
│   │   ├── DownloadContext.js      # Global download state & pipeline
│   │   └── AudioManager.js        # Singleton expo-av wrapper
│   │
│   ├── services/
│   │   ├── api.js                  # HTTP client for all server API calls
│   │   └── library.js              # Legacy local library manager
│   │
│   ├── components/
│   │   └── MiniPlayer.js           # Floating mini player bar
│   │
│   └── utils/
│       └── Storage.js              # Primary local filesystem & JSON data layer
│
├── assets/
│   ├── icon.png                    # App icon
│   └── splash-icon.png             # Splash screen image
│
├── android/                        # Native Android project (generated by Expo)
├── temp/                           # Server temp dir (auto-created, gitignored)
├── static/                         # Server static files dir (auto-created)
└── users.json                      # User accounts (auto-created on first register)
```

---

## Technology Stack

### Backend (`app.py`)
| Package | Purpose |
|---------|---------|
| `Flask` + `flask-cors` | HTTP server, CORS for cross-origin mobile requests |
| `spotify-scraper` | Scrapes Spotify embed pages — no API key needed |
| `yt-dlp` | Downloads audio from YouTube |
| `ffmpeg` | Converts audio to 192 kbps MP3 (called by yt-dlp) |
| `mutagen` | MP3 metadata (available, not currently used for tagging) |
| `requests` | Downloads album art images |
| `pandas` | Available for data processing (unused in current version) |

### Mobile App
| Package | Purpose |
|---------|---------|
| `expo` ~54 | React Native framework and toolchain |
| `expo-av` | Audio playback |
| `expo-file-system` | Local file read/write |
| `expo-linear-gradient` | UI gradient backgrounds |
| `@react-navigation/native` + `stack` | Screen navigation |
| `@react-native-async-storage/async-storage` | Persistent key-value store (credentials, settings) |
| `react-native-gesture-handler` | Touch gesture support |
| `react-native-sse` | (Available) SSE polyfill for React Native |

---

## Setup & Running

### 1. Start the Python Server

**Requirements:** Python 3.8+, `ffmpeg` installed and on PATH (or in `C:\ffmpeg\bin`)

```bash
# From the project root:
python app.py
```

The server auto-installs all missing Python packages on first run. Default port is **5001**. Set a custom port with:
```bash
GRAMOPHONE_PORT=8080 python app.py
```

On startup the server prints:
```
========================================================
  GRAMOPHONE SERVER v4.0 — spotify-scraper edition
========================================================
  Port       : 5001
  Temp dir   : /path/to/temp
  Users file : /path/to/users.json
  Users      : 0 registered
  ffmpeg     : on PATH
========================================================
```

Find your machine's local IP address and use it as the server URL in the app (e.g. `http://192.168.1.100:5001`). For remote access, use a tunneling service like `serveo` or `ngrok`.

### 2. Start the Mobile App (Development)

**Requirements:** Node.js, npm, Expo Go app on your phone (or Android emulator)

```bash
npm install
npm start           # starts Expo dev server
```

Scan the QR code with Expo Go, or press `a` for Android emulator.

---

## Building the APK

The project uses **Expo Application Services (EAS)** for builds. Configuration is in `eas.json`:

```json
{
  "build": {
    "preview": { "android": { "buildType": "apk" } },
    "production": { "android": { "buildType": "apk" } }
  }
}
```

**Build a preview APK:**
```bash
npx eas build --platform android --profile preview
```

**Build a production APK:**
```bash
npx eas build --platform android --profile production
```

The EAS project ID is `7a16cee5-9541-4b7a-a8ec-c98527b1b2c5` (set in `app.json`). You must be logged into an Expo account (`npx eas login`) to trigger cloud builds.

---

## Notes

- **No Spotify Premium required.** The server never touches the Spotify API directly. It scrapes the public embed page only.
- **Server stores nothing permanently.** All downloaded files are temporary and deleted after the phone retrieves them.
- **Offline playback.** Once songs are downloaded to the phone, the app and server are completely independent. Music plays without any network connection.
- **Reinstall-safe.** If a user reinstalls the app and logs in with the same name and server URL, they receive their original token back. Their download history is preserved.
- **Single-user per session.** Each registered user has their own isolated temp directory and download state on the server, supporting multiple concurrent users.
