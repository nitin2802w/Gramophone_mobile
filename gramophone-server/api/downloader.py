"""
Download thread — runs in background, downloads songs from YouTube.
Direct port from Flask app.py _download_thread().

Per-user state management for tracking download progress.
"""

import os
import re
import time
import shutil
import threading
import traceback

import yt_dlp
import requests as req

from django.conf import settings
from .spotify import fetch_playlist_tracks
from .models import GramophoneUser

# ══════════════════════════════════════════════════════════════════════════════
#  PER-USER DOWNLOAD STATE
# ══════════════════════════════════════════════════════════════════════════════
_user_states = {}
_state_lock  = threading.Lock()


def get_user_state(username: str) -> dict:
    with _state_lock:
        if username not in _user_states:
            _user_states[username] = {
                'downloading':   False,
                'current_track': '',
                'progress':      0,
                'total':         0,
                'playlist_name': '',
                'ready_files':   [],
                'events':        [],
                'condition':     threading.Condition(),
            }
        return _user_states[username]


# ══════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ══════════════════════════════════════════════════════════════════════════════
def find_ffmpeg():
    """Find ffmpeg on the system."""
    if shutil.which('ffmpeg'):
        return None   # already on PATH
    for path in [r'C:\ffmpeg\bin', r'C:\Program Files\ffmpeg\bin']:
        if os.path.isfile(os.path.join(path, 'ffmpeg.exe')):
            return path
    return None


FFMPEG_PATH = find_ffmpeg()


def download_image(url, save_path, log_cb=None):
    """Download cover art image with retries."""
    if not url or os.path.exists(save_path):
        return os.path.exists(save_path)
    for attempt in range(3):
        try:
            r = req.get(url, timeout=10)
            r.raise_for_status()
            with open(save_path, 'wb') as f:
                f.write(r.content)
            return True
        except Exception as e:
            if attempt == 2 and log_cb:
                log_cb(f'[WARN] Art: {e}')
            time.sleep(1)
    return False


def get_youtube_thumbnail(query):
    """Get YouTube thumbnail URL for a search query."""
    try:
        with yt_dlp.YoutubeDL({'quiet': True, 'cookiefile': os.path.join(settings.BASE_DIR, 'cookies.txt')}) as ydl:
            info = ydl.extract_info(f'ytsearch1:{query}', download=False)
            if 'entries' in info and info['entries']:
                return info['entries'][0].get('thumbnail')
    except Exception:
        return None


# ══════════════════════════════════════════════════════════════════════════════
#  DOWNLOAD THREAD
# ══════════════════════════════════════════════════════════════════════════════
def download_thread(url: str, username: str):
    """
    Background download thread — identical logic to Flask version.

    Flow for each song:
      1. Fetch playlist via spotify-scraper
      2. Download MP3 to temp/<username>/
      3. Emit "song_ready" event via SSE
      4. Phone calls GET /api/file/<mp3>
      5. Server streams file to phone
    """
    state     = get_user_state(username)
    user_temp = os.path.join(settings.TEMP_DIR, username)
    os.makedirs(user_temp, exist_ok=True)

    def event(data: dict):
        with state['condition']:
            state['events'].append(data)
            state['condition'].notify_all()

    def log(msg):
        print(f'[DL:{username}] {msg}', flush=True)
        event({'type': 'log', 'msg': msg})

    log('Starting download...')
    try:
        playlist_name, tracks = fetch_playlist_tracks(url, log)

        state['playlist_name'] = playlist_name
        state['total']         = len(tracks)
        state['progress']      = 0

        # Send full track list to phone upfront
        event({
            'type':          'playlist_info',
            'playlist_name': playlist_name,
            'total':         len(tracks),
            'tracks': [
                {
                    'title':  t.get('name', ''),
                    'artist': ', '.join(
                        a.get('name', '') for a in t.get('artists', [])),
                    'dur_ms': t.get('duration_ms', 0),
                }
                for t in tracks
            ],
        })

        base_opts = {
            'format':     'bestaudio/best',
            'noplaylist': True,
            'quiet':      True,
            'cookiefile': os.path.join(settings.BASE_DIR, 'cookies.txt'),
            'js-runtimes': 'node',
            'remote-components': 'ejs:github',
            'postprocessors': [{
                'key':              'FFmpegExtractAudio',
                'preferredcodec':   'mp3',
                'preferredquality': '192',
            }],
        }
        if FFMPEG_PATH:
            base_opts['ffmpeg_location'] = FFMPEG_PATH

        total  = len(tracks)
        failed = 0

        for i, track in enumerate(tracks, 1):
            tname  = track.get('name', '')
            artist = ', '.join(
                a.get('name', '') for a in track.get('artists', []))
            safe   = re.sub(r'[\\/*?:"<>|]', '', f'{tname} - {artist}')
            mp3    = os.path.join(user_temp, safe + '.mp3')
            jpg    = os.path.join(user_temp, safe + '.jpg')

            state['current_track'] = tname
            state['progress']      = i

            log(f'[{i}/{total}] {tname}')
            event({
                'type':   'track_start',
                'index':  i,
                'total':  total,
                'title':  tname,
                'artist': artist,
            })

            # Cover art
            images    = track.get('album', {}).get('images', [])
            image_url = images[0].get('url') if images else None
            if not image_url:
                image_url = get_youtube_thumbnail(f'{tname} {artist}')
            download_image(image_url, jpg, log)

            # MP3
            if os.path.exists(mp3):
                log(f'  [skip] Already exists: {tname}')
            else:
                try:
                    opts = {
                        **base_opts,
                        'outtmpl': os.path.join(user_temp, safe + '.%(ext)s'),
                    }
                    with yt_dlp.YoutubeDL(opts) as ydl:
                        ydl.download(
                            [f'ytsearch1:{tname} {artist} official audio'])
                except Exception as e:
                    failed += 1
                    log(f'[ERR] {tname}: {e}')
                    event({'type': 'track_failed', 'title': tname,
                           'reason': str(e)})
                    continue

            if not os.path.exists(mp3):
                failed += 1
                log(f'[ERR] {tname}: file missing after download')
                event({'type': 'track_failed', 'title': tname,
                       'reason': 'file not created'})
                continue

            # Song ready — notify phone
            entry = {
                'mp3':      safe + '.mp3',
                'jpg':      safe + '.jpg' if os.path.exists(jpg) else None,
                'title':    tname,
                'artist':   artist,
                'playlist': playlist_name,
                'index':    i - 1,
                'total':    total,
            }
            with _state_lock:
                state['ready_files'].append(entry)

            event({**entry, 'type': 'song_ready'})
            GramophoneUser.increment_downloads(username)

        summary = f"Done! '{playlist_name}' — {total} tracks"
        if failed:
            summary += f' ({failed} failed)'
        log(f'\n{summary}')
        event({
            'type':   'playlist_done',
            'name':   playlist_name,
            'total':  total,
            'failed': failed,
        })

    except Exception as e:
        log(f'[ERR] {e}\n{traceback.format_exc()}')
        event({'type': 'error', 'msg': str(e)})
    finally:
        state['downloading']   = False
        state['current_track'] = ''
        event({'type': 'done'})
