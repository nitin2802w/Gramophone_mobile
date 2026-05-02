# 🎵 Gramophone — Personal Music Server & Player

> **Stream your Spotify playlists to your phone. No subscriptions. No accounts. Just music.**

Gramophone is a cloud-hosted music system with two parts: a **Django backend server** running 24/7 on **AWS EC2** that scrapes Spotify playlists and downloads them as MP3s via YouTube, and a **React Native mobile app** (built with Expo) that auto-connects to the server, receives songs in real time, stores them locally, and plays them back — fully offline after download.

**Server URL:** `http://13.127.22.78:8000` (permanent — hardcoded in the app)

---

## Table of Contents

- [How It Works — Overview](#how-it-works--overview)
- [Architecture](#architecture)
- [Backend: Django on AWS](#backend-django-on-aws)
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
- [Deployment](#deployment)
- [Setup & Running](#setup--running)
- [Building the APK](#building-the-apk)

---

## How It Works — Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        USER'S FLOW                              │
│                                                                 │
│  1. Open the app → Enter your name → Get Started               │
│  2. Go to Download tab → Paste a Spotify playlist URL          │
│  3. Server scrapes Spotify, downloads audio from YouTube       │
│  4. Phone gets real-time progress via SSE polling              │
│  5. Each MP3 is pulled to the phone as it becomes ready        │
│  6. Songs are saved locally — play fully offline forever       │
└─────────────────────────────────────────────────────────────────┘

  ┌──────────────┐      HTTP / SSE      ┌──────────────────────────┐
  │  React Native│ ◄──────────────────► │  Django + Gunicorn       │
  │  Mobile App  │                     │  AWS EC2 (24/7)          │
  └──────────────┘                     └──────────────────────────┘
         │                                       │
   Stores MP3/JPG                     Downloads from YouTube
   locally on device                  via yt-dlp + ffmpeg
```

> **Note:** Users never enter a server URL. The app auto-connects to the permanent AWS server.

---

## Architecture

The project is split into two independent but tightly coupled systems:

| Layer | Tech | Location |
|-------|------|----------|
| **Backend Server** | Django 4.2 + Gunicorn | `gramophone-server/` (deployed on AWS EC2) |
| **Database** | SQLite via Django ORM | `db.sqlite3` on EC2 |
| **Mobile Frontend** | React Native + Expo SDK 54 | `src/` |
| **Local Storage** | `expo-file-system` + JSON files | Device filesystem |
| **Audio Playback** | `expo-av` | `AudioManager.js` |
| **Navigation** | React Navigation v7 | `App.js` |
| **State Management** | React Context API | `src/context/` |
| **Hosting** | AWS EC2 t2.micro (Free Tier) | Mumbai `ap-south-1` |
| **Permanent IP** | AWS Elastic IP | `13.127.22.78` |

---

## Backend: Django on AWS

The backend is a Django project deployed on AWS EC2 with Gunicorn as the WSGI server, managed by systemd for 24/7 uptime and auto-restart.

### Server Architecture

```
gramophone-server/
├── manage.py                    # Django management CLI
├── requirements.txt             # Python dependencies
├── setup.sh                     # One-time EC2 setup script
├── deploy.sh                    # Systemd service deployment
├── gramophone/                  # Django project settings
│   ├── settings.py              # Config (SQLite, CORS, paths)
│   ├── urls.py                  # Root URL routing
│   └── wsgi.py                  # Gunicorn entry point
└── api/                         # Django app (all endpoints)
    ├── models.py                # GramophoneUser model
    ├── views.py                 # All 15 API endpoints
    ├── urls.py                  # API URL routing
    ├── auth.py                  # Token auth decorator
    ├── spotify.py               # Spotify scraper logic
    └── downloader.py            # Download thread + per-user state
```

### User Management

Users are stored in a **SQLite database** via Django's ORM (`GramophoneUser` model). There is no manual registration UI — users register themselves from the mobile app.

| Method | Description |
|--------|-------------|
| `GramophoneUser.register(name)` | Creates a new user or returns the existing token for reinstalls. Sanitizes name, resolves collisions (e.g. `john`, `john_2`). Generates a 32-char random token. |
| `GramophoneUser.get_by_token(token)` | Reverse-lookup: finds a username from a token. Used by every authenticated route. |
| `GramophoneUser.increment_downloads(username)` | Increments the download counter for a user each time a song is successfully sent. |

**Database schema:**
```
gramophone_users table:
  id          INTEGER PRIMARY KEY
  username    VARCHAR(30) UNIQUE
  token       VARCHAR(64) UNIQUE
  created     DATE
  downloads   INTEGER DEFAULT 0
```

Each registered user also gets a private temp folder: `temp/<username>/`.

### Authentication

Every protected endpoint uses the `@auth_required` decorator (in `api/auth.py`):

```python
def auth_required(view_func):
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        token = get_token_from_request(request)
        username = GramophoneUser.get_by_token(token)
        if not username:
            return JsonResponse({"error": "Unauthorized"}, status=401)
        return view_func(request, *args, username=username, **kwargs)
    return wrapper
```

The token is accepted either in:
- `X-Auth-Token` HTTP header *(preferred)*
- `?token=` URL query parameter *(fallback for file downloads)*

### Download Pipeline

When the phone POSTs a Spotify URL to `/api/download`, the server launches a **background daemon thread** and immediately returns `{"ok": true}`. This is the core workflow inside `download_thread()`:

```
┌──────────────────────────────────────────────────────┐
│                  download_thread()                   │
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
- **ffmpeg installed via apt.** On EC2 Ubuntu, ffmpeg is available system-wide.
- **Force flag.** If the user sends `{"force": true}`, any stuck previous session is reset without returning a 409 error.

### SSE Event Stream

The mobile app polls `/api/download/stream` to receive live download progress. The server uses a **condition-variable-based event queue** per user:

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

Each call to `/api/download/stream` passes a `Last-Event-ID` header. The server returns all events from that ID onwards, then the client immediately re-polls.

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
| `GET /api/file/base64/<filename>` | Returns the file content Base64-encoded in a JSON field. |
| `GET /api/file/chunk/<filename>?offset=&length=` | Chunked transfer with `X-File-Size`, `X-Chunk-Offset`, `X-Chunk-Length` headers. |

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
| `WelcomeScreen` | `Welcome` | Name entry screen (auto-connects to server) |
| `PlayerScreen` | `Main` | Full-screen music player |
| `LibraryScreen` | `Library` | Browse downloaded playlists |
| `DownloadScreen` | `Download` | Download Spotify playlists |
| `SettingsScreen` | `Settings` | Server info, storage, logout |

3. **Tracks the current route** to conditionally show the `MiniPlayer` — hidden on `Welcome` and `Main`, visible on all other screens.

4. **Global dark theme** — background `#0d0d14` on all screens.

---

### Screens

#### `WelcomeScreen.js`
The first screen shown to new users. On load, it checks `AsyncStorage` for a saved `token` and `username`. If found, it skips to `PlayerScreen`. Otherwise, it shows the name entry form.

**UI:** Animated vinyl disc logo (rotates + pulses), name input, "Get Started →" button with a violet-to-rose gradient.

**Flow on connect:**
1. Validates name input
2. Calls `GET /api/status` to verify the server is reachable
3. Calls `POST /api/register` with the user's name
4. Saves `username` and `token` to `AsyncStorage`
5. Navigates to `Main`

> **Note:** No server URL input — the URL is hardcoded as a constant in `api.js`.

#### `PlayerScreen.js`
The full-screen music player. Shows album art, song title, artist, playlist name, playback progress bar, and controls: shuffle, previous, play/pause, next, repeat. Also shows a scrollable queue.

#### `LibraryScreen.js`
Displays all locally downloaded playlists as cards with cover art and song count. Tapping a playlist loads it into the player. Supports deleting playlists.

#### `DownloadScreen.js`
Contains a text input for Spotify playlist URLs and a "Download" button. Shows live track list with per-song status icons and a scrollable log during download.

#### `SettingsScreen.js`
Shows server status (online/offline indicator), username, and server URL (read-only). Provides logout and cache clearing functionality.

---

### Contexts (Global State)

#### `PlayerContext.js` + `AudioManager.js`

`PlayerContext` provides all playback state and controls. `AudioManager` is a singleton ensuring only one `expo-av` Sound object exists at a time.

**State:** `songs`, `currentIdx`, `isPlaying`, `position`, `duration`, `progress`, `currentPl`, `playlists`, `shuffle`, `repeat`, `currentSong`

**Actions:** `playSong`, `nextSong`, `prevSong`, `togglePlay`, `toggleShuffle`, `toggleRepeat`, `seekTo`, `loadPlaylist`, `loadLibrary`, `getQueue`

#### `DownloadContext.js`

Manages the entire download lifecycle. State lives here (outside `DownloadScreen`) so progress is not lost when navigating.

**State:** `downloading`, `logs`, `trackList`, `trackStatus`, `plName`, `done`, `total`, `savedCount`

**Flow:** `startDownload(url)` → resets state → reads server URL from hardcoded constant → POSTs to `/api/download` → starts SSE polling → processes download queue → `finishUp()` checks for missed songs → cleanup.

---

### Services

#### `src/services/api.js`
HTTP client layer with a **hardcoded server URL** (`http://13.127.22.78:8000`).

| Export | Description |
|--------|-------------|
| `getServerUrl()` | Returns the hardcoded server URL constant |
| `getToken()` | Read auth token from AsyncStorage |
| `getUsername()` | Read username from AsyncStorage |
| `saveCredentials(user, token)` | Save username and token to AsyncStorage |
| `clearCredentials()` | Remove credentials (logout) |
| `apiCall(path, method, body)` | Generic authenticated API call with `X-Auth-Token` |
| `registerUser(name)` | POST to `/api/register` |
| `checkStatus()` | GET `/api/status` |
| `startDownload(url, force?)` | POST to `/api/download` |
| `cancelDownload()` | POST `/api/download/cancel` |
| `getDownloadStatus()` | GET `/api/download/status` |
| `getReadyFiles()` | GET `/api/files/ready` |
| `cleanupFiles()` | POST `/api/files/cleanup` |
| `getMyProfile()` | GET `/api/me` |

#### `src/services/library.js`
Legacy library management service (predates `Storage.js`). Kept for compatibility.

---

### Utils

#### `src/utils/Storage.js`
Primary local data layer. Playlists and songs stored as JSON files in `<documentDirectory>/Gramophone/`.

```
Gramophone/
  playlists.json           ← Index of all playlists
  <PlaylistName>/
    songs.json             ← Index of songs in this playlist
    Song Title - Artist.mp3
    Song Title - Artist.jpg
```

Key functions: `ensureRoot`, `getPlaylists`, `addPlaylist`, `deletePlaylist`, `getSongs`, `addSong` (with deduplication), `downloadFileToPhone` (90s timeout, partial cleanup), `getStorageInfo`, `formatDuration`.

---

### Components

#### `src/components/MiniPlayer.js`
Persistent mini player bar floating at the bottom of Library, Download, and Settings screens. Shows album art, song title/artist, and playback controls.

---

## Project File Structure

```
gramophone/
├── App.js                          # React Native app root
├── index.js                        # Expo entry point
├── app.json                        # Expo config
├── package.json                    # JS dependencies
├── eas.json                        # EAS build config
│
├── src/
│   ├── screens/
│   │   ├── WelcomeScreen.js        # Name entry (no URL input)
│   │   ├── PlayerScreen.js         # Full-screen music player
│   │   ├── LibraryScreen.js        # Browse downloaded playlists
│   │   ├── Downloadscreen.js       # Download Spotify playlists
│   │   └── Settingscreen.js        # Settings, storage, logout
│   ├── context/
│   │   ├── PlayerContext.js        # Global playback state & controls
│   │   ├── DownloadContext.js      # Global download state & pipeline
│   │   └── AudioManager.js        # Singleton expo-av wrapper
│   ├── services/
│   │   ├── api.js                  # HTTP client (hardcoded server URL)
│   │   └── library.js              # Legacy local library manager
│   ├── components/
│   │   └── MiniPlayer.js           # Floating mini player bar
│   └── utils/
│       └── Storage.js              # Local filesystem & JSON data layer
│
├── gramophone-server/              # Django backend (deployed on AWS EC2)
│   ├── manage.py                   # Django CLI
│   ├── requirements.txt            # Python dependencies
│   ├── setup.sh                    # One-time EC2 setup
│   ├── deploy.sh                   # Systemd service deployment
│   ├── gramophone/
│   │   ├── settings.py             # Django settings (SQLite, CORS)
│   │   ├── urls.py                 # Root URL routing
│   │   └── wsgi.py                 # Gunicorn WSGI entry
│   └── api/
│       ├── models.py               # GramophoneUser model
│       ├── views.py                # All 15 API endpoints
│       ├── urls.py                 # API URL routing
│       ├── auth.py                 # Token auth decorator
│       ├── spotify.py              # Spotify scraper
│       └── downloader.py           # Download thread + state
│
├── app.py                          # Legacy Flask backend (deprecated)
└── assets/                         # App icons and splash screen
```

---

## Technology Stack

### Backend (Django on AWS EC2)
| Package | Purpose |
|---------|---------|
| `Django 4.2` | Web framework with ORM |
| `Gunicorn` | Production WSGI server (2 workers, 4 threads) |
| `django-cors-headers` | CORS for mobile app requests |
| `spotifyscraper` | Scrapes Spotify embed pages — no API key needed |
| `yt-dlp` | Downloads audio from YouTube |
| `ffmpeg` | Converts audio to 192 kbps MP3 |
| `mutagen` | MP3 metadata handling |
| `requests` | Downloads album art images |
| `SQLite` | User database (via Django ORM) |

### Mobile App
| Package | Purpose |
|---------|---------|
| `expo` ~54 | React Native framework and toolchain |
| `expo-av` | Audio playback |
| `expo-file-system` | Local file read/write |
| `expo-linear-gradient` | UI gradient backgrounds |
| `@react-navigation/native` + `stack` | Screen navigation |
| `@react-native-async-storage/async-storage` | Persistent key-value store |
| `react-native-gesture-handler` | Touch gesture support |

### Infrastructure
| Service | Purpose |
|---------|---------|
| AWS EC2 `t2.micro` | Server instance (Free Tier — 750 hrs/month) |
| AWS Elastic IP | Permanent public IP address |
| Ubuntu 24.04 LTS | Server operating system |
| systemd | Process manager (auto-restart, boot start) |

---

## Deployment

### AWS Infrastructure

| Resource | Value |
|----------|-------|
| Instance | `t2.micro` (1 vCPU, 1GB RAM) |
| Region | `ap-south-1` (Mumbai) |
| Elastic IP | `13.127.22.78` |
| OS | Ubuntu 24.04 LTS |
| Port | 8000 |
| Cost | **$0** (Free Tier for 12 months) |

### Deploy from Scratch

```bash
# 1. Copy project to EC2
scp -i gramophone-key.pem -r gramophone-server/ ubuntu@13.127.22.78:~/

# 2. SSH in
ssh -i gramophone-key.pem ubuntu@13.127.22.78

# 3. Run setup (installs Python, ffmpeg, pip packages, runs migrations)
cd ~/gramophone-server
chmod +x setup.sh deploy.sh
bash setup.sh

# 4. Deploy as 24/7 systemd service
sudo bash deploy.sh

# 5. Verify
curl http://localhost:8000/api/status
```

### Server Management

```bash
sudo systemctl status gramophone      # Check status
sudo systemctl restart gramophone     # Restart
sudo systemctl stop gramophone        # Stop
sudo journalctl -u gramophone -f      # Live logs
sudo journalctl -u gramophone -n 100  # Last 100 log lines
```

---

## Setup & Running

### Mobile App (Development)

**Requirements:** Node.js, npm, Expo Go app on your phone

```bash
npm install
npm start           # starts Expo dev server
```

Scan the QR code with Expo Go, or press `a` for Android emulator.

The app auto-connects to `http://13.127.22.78:8000` — no server URL entry needed.

---

## Building the APK

The project uses **Expo Application Services (EAS)** for builds:

```bash
# Preview APK
npx eas build --platform android --profile preview

# Production APK
npx eas build --platform android --profile production
```

The EAS project ID is `7a16cee5-9541-4b7a-a8ec-c98527b1b2c5` (set in `app.json`).

---

## Notes

- **No Spotify Premium required.** The server scrapes the public embed page only — no API key needed.
- **Server stores nothing permanently.** Downloaded files are temporary and deleted after the phone retrieves them.
- **Offline playback.** Once songs are on the phone, no network connection is needed.
- **Reinstall-safe.** Same name = same token. Download history is preserved.
- **Multi-user support.** Each user has isolated temp storage and download state.
- **24/7 uptime.** systemd auto-restarts the server on crash or reboot.
- **Free hosting.** AWS Free Tier covers the first 12 months. After that, ~$8.50/month for t2.micro.
