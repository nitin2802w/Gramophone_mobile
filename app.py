"""
GRAMOPHONE — Server Backend (Termux / Android Edition)
=======================================================
Version 4.0 — spotify-scraper edition (no API tokens, no rate limits)

Features:
  - Uses spotify-scraper to pull playlist metadata (up to 100 songs)
  - No Spotify API tokens — scrapes embed page directly
  - Auto user registration (no manual user management)
  - Songs download to temp, auto-transfer to phone, then deleted
  - Server stores NOTHING permanently except user accounts
  - No pygame — server does not play audio
"""

import sys, os, traceback, subprocess

# ── UTF-8 output ────────────────────────────────────────────────────────────────
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass
os.environ.setdefault("PYTHONIOENCODING", "utf-8")
os.environ.setdefault("PYTHONUTF8", "1")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOG_FILE = os.path.join(BASE_DIR, "error.log")


# ── Crash logger ────────────────────────────────────────────────────────────────
def fatal(msg):
    full = f"FATAL: {msg}\n\n{traceback.format_exc()}"
    print(full, file=sys.stderr, flush=True)
    try:
        with open(LOG_FILE, "w") as f:
            f.write(full)
    except Exception:
        pass
    sys.exit(1)


# ══════════════════════════════════════════════════════════════════════════════
#  PACKAGE INSTALLER
# ══════════════════════════════════════════════════════════════════════════════
REQUIRED = {
    "flask":           "flask",
    "flask_cors":      "flask-cors",
    "mutagen":         "mutagen",
    "pandas":          "pandas",
    "yt_dlp":          "yt-dlp",
    "requests":        "requests",
    "spotify_scraper": "spotify-scraper",  # scrapes embed page — no API key needed
}


def _can_import(mod):
    try:
        __import__(mod)
        return True
    except ImportError:
        return False


def _pip(*args):
    r = subprocess.run(
        [sys.executable, "-m", "pip", *args],
        capture_output=True, text=True
    )
    return r.returncode, r.stdout + r.stderr


def install_packages():
    missing = [pip for mod, pip in REQUIRED.items() if not _can_import(mod)]
    if missing:
        print(f"[Setup] Installing: {', '.join(missing)}", flush=True)
        rc, out = _pip("install", "--upgrade", *missing)
        if rc != 0:
            fatal(f"pip install failed:\n{out}\nTry: pip install {' '.join(missing)}")
        print("[Setup] Done.\n", flush=True)


try:
    install_packages()
except SystemExit:
    raise
except Exception as e:
    fatal(f"Package install error: {e}")


# ── Imports ────────────────────────────────────────────────────────────────────
try:
    import re, shutil, random, threading, json, time, queue, secrets, string, base64
    from datetime import datetime
    from functools import wraps
    from mutagen.mp3 import MP3
    import pandas as pd
    import yt_dlp
    import requests as req
    from spotify_scraper import SpotifyClient
    from flask import (
        Flask, jsonify, request,
        send_from_directory, Response, send_file,
        stream_with_context
    )
    from flask_cors import CORS
except ImportError as e:
    fatal(f"Import error: {e}")


# ══════════════════════════════════════════════════════════════════════════════
#  PATHS
# ══════════════════════════════════════════════════════════════════════════════
TEMP_DIR   = os.path.join(BASE_DIR, "temp")
STATIC_DIR = os.path.join(BASE_DIR, "static")
USERS_FILE = os.path.join(BASE_DIR, "users.json")

for _d in [TEMP_DIR, STATIC_DIR]:
    os.makedirs(_d, exist_ok=True)


# ── ffmpeg ─────────────────────────────────────────────────────────────────────
def find_ffmpeg():
    if shutil.which("ffmpeg"):
        return None   # already on PATH (Termux: pkg install ffmpeg)
    for path in [r"C:\ffmpeg\bin", r"C:\Program Files\ffmpeg\bin"]:
        if os.path.isfile(os.path.join(path, "ffmpeg.exe")):
            return path
    return None


FFMPEG_PATH = find_ffmpeg()


# ══════════════════════════════════════════════════════════════════════════════
#  USER MANAGEMENT
# ══════════════════════════════════════════════════════════════════════════════
_users_lock = threading.Lock()


def _load_users() -> dict:
    try:
        if os.path.exists(USERS_FILE):
            with open(USERS_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
    except Exception:
        pass
    return {}


def _save_users(users: dict):
    tmp = USERS_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(users, f, indent=2)
    os.replace(tmp, USERS_FILE)


def _generate_token(length=32) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def register_user(name: str) -> dict:
    clean = re.sub(r"[^a-z0-9_]", "", name.lower().strip())[:30]
    if not clean:
        clean = "user"

    with _users_lock:
        users = _load_users()

        # Existing user — return same token (reinstall safe)
        if clean in users:
            return {
                "username": clean,
                "token":    users[clean]["token"],
                "new_user": False,
            }

        # Resolve name collision
        base, suffix = clean, 2
        while clean in users:
            clean = f"{base}_{suffix}"
            suffix += 1

        token = _generate_token()
        users[clean] = {
            "token":     token,
            "created":   datetime.now().strftime("%Y-%m-%d"),
            "downloads": 0,
        }
        _save_users(users)
        os.makedirs(os.path.join(TEMP_DIR, clean), exist_ok=True)
        print(f"[Users] Registered: {clean}", flush=True)

        return {"username": clean, "token": token, "new_user": True}


def get_user_by_token(token: str):
    if not token:
        return None
    with _users_lock:
        users = _load_users()
        for username, info in users.items():
            if info.get("token") == token:
                return username
    return None


def increment_downloads(username: str):
    with _users_lock:
        users = _load_users()
        if username in users:
            users[username]["downloads"] = (
                users[username].get("downloads", 0) + 1)
            _save_users(users)


# ══════════════════════════════════════════════════════════════════════════════
#  AUTH
# ══════════════════════════════════════════════════════════════════════════════
def get_token_from_request() -> str:
    return (
        request.headers.get("X-Auth-Token")
        or request.args.get("token")
        or ""
    )


def auth_required(fn):
    """Injects username=<str> into the endpoint function."""
    @wraps(fn)
    def wrapper(*args, **kwargs):
        token    = get_token_from_request()
        username = get_user_by_token(token)
        if not username:
            return jsonify({
                "error": "Unauthorized",
                "hint":  "Register via POST /api/register {name:'YourName'}"
            }), 401
        return fn(*args, username=username, **kwargs)
    return wrapper


# ══════════════════════════════════════════════════════════════════════════════
#  PER-USER DOWNLOAD STATE
# ══════════════════════════════════════════════════════════════════════════════
_user_states = {}
_state_lock  = threading.Lock()


def get_user_state(username: str) -> dict:
    with _state_lock:
        if username not in _user_states:
            _user_states[username] = {
                "downloading":   False,
                "current_track": "",
                "progress":      0,
                "total":         0,
                "playlist_name": "",
                "ready_files":   [],
                "events":        [],
                "condition":     threading.Condition(),
            }
        return _user_states[username]


# ══════════════════════════════════════════════════════════════════════════════
#  IMAGE DOWNLOAD
# ══════════════════════════════════════════════════════════════════════════════
def download_image(url, save_path, log_cb=None):
    if not url or os.path.exists(save_path):
        return os.path.exists(save_path)
    for attempt in range(3):
        try:
            r = req.get(url, timeout=10)
            r.raise_for_status()
            with open(save_path, "wb") as f:
                f.write(r.content)
            return True
        except Exception as e:
            if attempt == 2 and log_cb:
                log_cb(f"[WARN] Art: {e}")
            time.sleep(1)
    return False


def get_youtube_thumbnail(query):
    try:
        with yt_dlp.YoutubeDL({"quiet": True}) as ydl:
            info = ydl.extract_info(f"ytsearch1:{query}", download=False)
            if "entries" in info and info["entries"]:
                return info["entries"][0].get("thumbnail")
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  SPOTIFY — via spotify-scraper (scrapes embed page, no API tokens needed)
#  Gets up to 100 tracks — fast, no rate limits, no token expiry headaches.
# ══════════════════════════════════════════════════════════════════════════════
def fetch_playlist_tracks(url: str, log):
    """
    Uses spotify-scraper to pull playlist name + up to 100 tracks.
    Returns: (playlist_name: str, tracks: list[dict])
    Each track has: name, duration_ms, artists=[{name}], album={name, images=[{url}]}
    """
    log("[Spotify] Fetching playlist via spotify-scraper...")
    client   = SpotifyClient()
    playlist = client.get_playlist_info(url)

    raw_name = playlist.get("name", "Untitled_Playlist")
    name     = re.sub(r'[\\/*?:"<>|]', "", raw_name).strip()
    tracks   = playlist.get("tracks", [])

    log(f"[Spotify] '{name}' — {len(tracks)} tracks")
    return name, tracks


# ══════════════════════════════════════════════════════════════════════════════
#  DOWNLOAD THREAD
#
#  Flow for each song:
#    1. Fetch playlist via spotify-scraper (no API token)
#    2. Download MP3 to temp/<username>/
#    3. Emit "song_ready" event via SSE
#    4. Phone calls GET /api/file/<filename>
#    5. Server streams file to phone
#    6. Server deletes file immediately after sending
# ══════════════════════════════════════════════════════════════════════════════
def _download_thread(url: str, username: str):
    state     = get_user_state(username)
    user_temp = os.path.join(TEMP_DIR, username)
    os.makedirs(user_temp, exist_ok=True)

    def event(data: dict):
        with state["condition"]:
            state["events"].append(data)
            state["condition"].notify_all()

    def log(msg):
        print(f"[DL:{username}] {msg}", flush=True)
        event({"type": "log", "msg": msg})

    log("Starting download...")
    try:
        playlist_name, tracks = fetch_playlist_tracks(url, log)

        state["playlist_name"] = playlist_name
        state["total"]         = len(tracks)
        state["progress"]      = 0

        # Send full track list to phone upfront
        event({
            "type":          "playlist_info",
            "playlist_name": playlist_name,
            "total":         len(tracks),
            "tracks": [
                {
                    "title":  t.get("name", ""),
                    "artist": ", ".join(
                        a.get("name", "") for a in t.get("artists", [])),
                    "dur_ms": t.get("duration_ms", 0),
                }
                for t in tracks
            ],
        })

        base_opts = {
            "format":     "bestaudio/best",
            "noplaylist": True,
            "quiet":      True,
            "postprocessors": [{
                "key":              "FFmpegExtractAudio",
                "preferredcodec":   "mp3",
                "preferredquality": "192",
            }],
        }
        if FFMPEG_PATH:
            base_opts["ffmpeg_location"] = FFMPEG_PATH

        total  = len(tracks)
        failed = 0

        for i, track in enumerate(tracks, 1):
            tname  = track.get("name", "")
            artist = ", ".join(
                a.get("name", "") for a in track.get("artists", []))
            safe   = re.sub(r'[\\/*?:"<>|]', "", f"{tname} - {artist}")
            mp3    = os.path.join(user_temp, safe + ".mp3")
            jpg    = os.path.join(user_temp, safe + ".jpg")

            state["current_track"] = tname
            state["progress"]      = i

            log(f"[{i}/{total}] {tname}")
            event({
                "type":   "track_start",
                "index":  i,
                "total":  total,
                "title":  tname,
                "artist": artist,
            })

            # Cover art
            images    = track.get("album", {}).get("images", [])
            image_url = images[0].get("url") if images else None
            if not image_url:
                image_url = get_youtube_thumbnail(f"{tname} {artist}")
            download_image(image_url, jpg, log)

            # MP3
            if os.path.exists(mp3):
                log(f"  [skip] Already exists: {tname}")
            else:
                try:
                    opts = {
                        **base_opts,
                        "outtmpl": os.path.join(user_temp, safe + ".%(ext)s"),
                    }
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        ydl.download(
                            [f"ytsearch1:{tname} {artist} official audio"])
                except Exception as e:
                    failed += 1
                    log(f"[ERR] {tname}: {e}")
                    event({"type": "track_failed", "title": tname, "reason": str(e)})
                    continue

            if not os.path.exists(mp3):
                failed += 1
                log(f"[ERR] {tname}: file missing after download")
                event({"type": "track_failed", "title": tname,
                       "reason": "file not created"})
                continue

            # Song ready — notify phone
            entry = {
                "mp3":      safe + ".mp3",
                "jpg":      safe + ".jpg" if os.path.exists(jpg) else None,
                "title":    tname,
                "artist":   artist,
                "playlist": playlist_name,
                "index":    i - 1,
                "total":    total,
            }
            with _state_lock:
                state["ready_files"].append(entry)

            event({**entry, "type": "song_ready"})
            increment_downloads(username)

        summary = f"Done! '{playlist_name}' — {total} tracks"
        if failed:
            summary += f" ({failed} failed)"
        log(f"\n{summary}")
        event({
            "type":   "playlist_done",
            "name":   playlist_name,
            "total":  total,
            "failed": failed,
        })

    except Exception as e:
        log(f"[ERR] {e}\n{traceback.format_exc()}")
        event({"type": "error", "msg": str(e)})
    finally:
        state["downloading"]   = False
        state["current_track"] = ""
        event({"type": "done"})


# ══════════════════════════════════════════════════════════════════════════════
#  FLASK APP
# ══════════════════════════════════════════════════════════════════════════════
app = Flask(__name__, static_folder=STATIC_DIR)
CORS(app, resources={r"/api/*": {"origins": "*"}})


@app.route("/")
def index():
    html = os.path.join(BASE_DIR, "index.html")
    if os.path.exists(html):
        return send_from_directory(BASE_DIR, "index.html")
    return jsonify({
        "status":  "Gramophone Server v4.0",
        "tip":     "POST /api/register {name:'YourName'} to get started",
    })


# ── Status (public) ────────────────────────────────────────────────────────────
@app.route("/api/status")
def api_status():
    with _users_lock:
        user_count = len(_load_users())
    return jsonify({
        "ok":      True,
        "server":  "Gramophone Termux Server",
        "version": "4.0",
        "users":   user_count,
    })


# ══════════════════════════════════════════════════════════════════════════════
#  REGISTRATION
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/register", methods=["POST"])
def api_register():
    data = request.get_json(silent=True) or {}
    name = data.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    if len(name) > 50:
        return jsonify({"error": "Name too long (max 50 chars)"}), 400

    result = register_user(name)
    return jsonify(result), 201 if result["new_user"] else 200


@app.route("/api/me")
@auth_required
def api_me(username):
    with _users_lock:
        info = _load_users().get(username, {})
    return jsonify({
        "username":  username,
        "created":   info.get("created", ""),
        "downloads": info.get("downloads", 0),
    })


@app.route("/api/users")
def api_users():
    """List all users — requires ADMIN_TOKEN env var."""
    admin = os.environ.get("ADMIN_TOKEN", "")
    if admin and get_token_from_request() != admin:
        return jsonify({"error": "Admin access only"}), 401
    with _users_lock:
        users = _load_users()
    return jsonify({
        "count": len(users),
        "users": [
            {"username": u, "created": d.get("created", ""),
             "downloads": d.get("downloads", 0)}
            for u, d in users.items()
        ],
    })


# ══════════════════════════════════════════════════════════════════════════════
#  DOWNLOAD ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/download/cancel", methods=["POST"])
@auth_required
def api_download_cancel(username):
    """Cancel / reset a stuck download session. Safe to call anytime."""
    state = get_user_state(username)
    with state["condition"]:
        state["downloading"]   = False
        state["current_track"] = ""
        state["progress"]      = 0
        state["ready_files"]   = []
        state["events"].append({"type": "done"})
        state["condition"].notify_all()
    
    print(f"[Cancel] Download reset for {username}", flush=True)
    return jsonify({"ok": True, "message": "Download cancelled"})


@app.route("/api/download", methods=["POST"])
@auth_required
def api_download(username):
    """
    Start downloading a Spotify playlist.

    Body: { "url": "https://open.spotify.com/playlist/...", "force": false }

    Pass force=true to cancel any stuck previous session (fixes 409 errors).
    """
    data  = request.get_json(silent=True) or {}
    url   = data.get("url", "").strip()
    force = bool(data.get("force", False))
    if not url:
        return jsonify({"error": "No URL provided"}), 400

    state = get_user_state(username)
    if state["downloading"]:
        if not force:
            return jsonify({
                "error": "Already downloading",
                "hint":  "Pass force=true to cancel the stuck session and restart",
            }), 409
        print(f"[Download] Force-reset for {username}", flush=True)
        state["downloading"] = False

    state["downloading"]   = True
    state["ready_files"]   = []
    state["current_track"] = ""
    state["progress"]      = 0
    with state["condition"]:
        state["events"] = []

    threading.Thread(
        target=_download_thread,
        args=(url, username),
        daemon=True,
    ).start()

    return jsonify({"ok": True, "message": "Download started"})


@app.route("/api/download/stream")
@auth_required
def api_download_stream(username):
    """
    SSE stream — phone listens here for live download progress.

    Event types:
      log           — text progress line
      playlist_info — full track list sent at start
      track_start   — a song is being downloaded
      song_ready    — PULL THIS FILE: GET /api/file/<mp3>
      track_failed  — this song failed
      playlist_done — all songs done
      done          — stream closing
      ping          — keepalive (every 30s)
    """
    state = get_user_state(username)
    
    last_id_str = request.headers.get("Last-Event-ID")
    index = int(last_id_str) if last_id_str and last_id_str.isdigit() else 0

    with state["condition"]:
        # Wait up to 10 seconds if no new events are available
        if len(state["events"]) <= index:
            state["condition"].wait(timeout=10)
        
        # Grab all events from index onwards
        new_events = state["events"][index:]
    
    # If still no events after timeout, return an empty ping
    if not new_events:
        text_resp = 'data: {"type":"ping"}\n\n'
    else:
        text_lines = []
        for i, msg in enumerate(new_events):
            event_id = index + i
            text_lines.append(f"id: {event_id}")
            text_lines.append(f"data: {json.dumps(msg, ensure_ascii=False)}")
            text_lines.append("")
            text_lines.append("")
        
        text_resp = "\n".join(text_lines)

    return Response(
        text_resp,
        mimetype="text/plain",
        headers={
            "Cache-Control": "no-cache",
        },
    )


@app.route("/api/download/status")
@auth_required
def api_download_status(username):
    s = get_user_state(username)
    return jsonify({
        "downloading":   s["downloading"],
        "current_track": s["current_track"],
        "progress":      s["progress"],
        "total":         s["total"],
        "playlist_name": s["playlist_name"],
        "ready_count":   len(s["ready_files"]),
    })


# ══════════════════════════════════════════════════════════════════════════════
#  FILE ENDPOINTS
#  Phone pulls files here. Server deletes immediately after sending.
# ══════════════════════════════════════════════════════════════════════════════
@app.route("/api/file/<path:filename>")
@auth_required
def api_get_file(username, filename):
    """Download a file to phone. File is kept on server until cleanup."""
    user_temp = os.path.join(TEMP_DIR, username)
    file_path = os.path.join(user_temp, filename)

    # Security: prevent path traversal
    if not os.path.abspath(file_path).startswith(
            os.path.abspath(user_temp) + os.sep):
        return jsonify({"error": "Invalid path"}), 400

    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404

    lower = filename.lower()
    if lower.endswith(".mp3"):
        mime = "audio/mpeg"
    elif lower.endswith((".jpg", ".jpeg")):
        mime = "image/jpeg"
    else:
        mime = "application/octet-stream"

    try:
        with open(file_path, "rb") as f:
            data = f.read()

        return Response(
            data,
            mimetype=mime,
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(data)),
                "Accept-Ranges": "none",
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/file/base64/<path:filename>")
@auth_required
def api_get_file_base64(username, filename):
    user_temp = os.path.join(TEMP_DIR, username)
    file_path = os.path.join(user_temp, filename)

    if not os.path.abspath(file_path).startswith(os.path.abspath(user_temp) + os.sep):
        return jsonify({"error": "Invalid path"}), 400

    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404

    try:
        with open(file_path, "rb") as f:
            encoded = base64.b64encode(f.read()).decode("utf-8")
        return jsonify({"data": encoded})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/file/chunk/<path:filename>")
@auth_required
def api_get_file_chunk(username, filename):
    user_temp = os.path.join(TEMP_DIR, username)
    file_path = os.path.join(user_temp, filename)

    if not os.path.abspath(file_path).startswith(os.path.abspath(user_temp) + os.sep):
        return jsonify({"error": "Invalid path"}), 400

    if not os.path.exists(file_path):
        return jsonify({"error": "File not found"}), 404

    try:
        offset = int(request.args.get("offset", "0"))
        length = int(request.args.get("length", str(256 * 1024)))
    except ValueError:
        return jsonify({"error": "Invalid offset/length"}), 400

    if offset < 0 or length <= 0:
        return jsonify({"error": "Invalid offset/length"}), 400

    total_size = os.path.getsize(file_path)
    if offset >= total_size:
        return jsonify({"error": "Offset out of range", "size": total_size}), 416

    lower = filename.lower()
    if lower.endswith(".mp3"):
        mime = "audio/mpeg"
    elif lower.endswith((".jpg", ".jpeg")):
        mime = "image/jpeg"
    else:
        mime = "application/octet-stream"

    try:
        with open(file_path, "rb") as f:
            f.seek(offset)
            chunk = f.read(length)

        return Response(
            chunk,
            mimetype=mime,
            headers={
                "Content-Length": str(len(chunk)),
                "X-File-Size": str(total_size),
                "X-Chunk-Offset": str(offset),
                "X-Chunk-Length": str(len(chunk)),
                "X-File-Name": filename,
                "Accept-Ranges": "bytes",
            }
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/files/ready")
@auth_required
def api_ready_files(username):
    """List files ready to pull (useful if SSE was dropped)."""
    state = get_user_state(username)
    return jsonify({
        "ready": state["ready_files"],
        "count": len(state["ready_files"]),
    })


@app.route("/api/files/cleanup", methods=["POST"])
@auth_required
def api_cleanup(username):
    """Delete all remaining temp files for this user."""
    user_temp = os.path.join(TEMP_DIR, username)
    deleted   = 0
    if os.path.isdir(user_temp):
        for f in os.listdir(user_temp):
            try:
                os.remove(os.path.join(user_temp, f))
                deleted += 1
            except Exception:
                pass
    get_user_state(username)["ready_files"] = []
    return jsonify({"ok": True, "deleted": deleted})


# ── Admin endpoints ────────────────────────────────────────────────────────────
@app.route("/api/server/storage")
def api_storage():
    admin = os.environ.get("ADMIN_TOKEN", "")
    if admin and get_token_from_request() != admin:
        return jsonify({"error": "Admin only"}), 401
    total, count = 0, 0
    for root, _, files in os.walk(TEMP_DIR):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
                count += 1
            except Exception:
                pass
    return jsonify({
        "temp_files":    count,
        "temp_size_mb":  round(total / 1024 / 1024, 2),
        "users_file":    USERS_FILE,
    })


@app.route("/api/error-log")
def api_error_log():
    if os.path.exists(LOG_FILE):
        with open(LOG_FILE) as f:
            return jsonify({"log": f.read()})
    return jsonify({"log": None})


# ══════════════════════════════════════════════════════════════════════════════
#  STARTUP CLEANUP
# ══════════════════════════════════════════════════════════════════════════════
def startup_cleanup():
    """Remove leftover temp files from any previously crashed session."""
    deleted = 0
    for root, _, files in os.walk(TEMP_DIR):
        for f in files:
            try:
                os.remove(os.path.join(root, f))
                deleted += 1
            except Exception:
                pass
    if deleted:
        print(f"[Startup] Removed {deleted} leftover temp files.", flush=True)


# ══════════════════════════════════════════════════════════════════════════════
#  ENTRY POINT
# ══════════════════════════════════════════════════════════════════════════════
if __name__ == "__main__":
    startup_cleanup()
    port = int(os.environ.get("GRAMOPHONE_PORT", 5001))

    with _users_lock:
        user_count = len(_load_users())

    print("\n" + "=" * 56, flush=True)
    print("  GRAMOPHONE SERVER v4.0 — spotify-scraper edition", flush=True)
    print("=" * 56, flush=True)
    print(f"  Port       : {port}", flush=True)
    print(f"  Temp dir   : {TEMP_DIR}", flush=True)
    print(f"  Users file : {USERS_FILE}", flush=True)
    print(f"  Users      : {user_count} registered", flush=True)
    print(f"  ffmpeg     : {'on PATH' if not FFMPEG_PATH else FFMPEG_PATH}",
          flush=True)
    print("=" * 56, flush=True)
    print("  HOW TO USE:", flush=True)
    print(f"  1. Find IP:  ip addr | grep 'inet '", flush=True)
    print(f"  2. Status:   http://<ip>:{port}/api/status", flush=True)
    print(f"  3. Register: POST /api/register", flush=True)
    print(f"               body: {{\"name\": \"YourName\"}}", flush=True)
    print("=" * 56 + "\n", flush=True)

    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)
