"""
Spotify playlist fetcher — uses spotify-scraper (no API tokens needed).
Direct port from Flask app.py.
"""

import re
from spotify_scraper import SpotifyClient


def fetch_playlist_tracks(url: str, log):
    """
    Uses spotify-scraper to pull playlist name + up to 100 tracks.
    Returns: (playlist_name: str, tracks: list[dict])
    Each track has: name, duration_ms, artists=[{name}], album={name, images=[{url}]}
    """
    log('[Spotify] Fetching playlist via spotify-scraper...')
    client   = SpotifyClient()
    playlist = client.get_playlist_info(url)

    raw_name = playlist.get('name', 'Untitled_Playlist')
    name     = re.sub(r'[\\/*?:"<>|]', '', raw_name).strip()
    tracks   = playlist.get('tracks', [])

    log(f"[Spotify] '{name}' — {len(tracks)} tracks")
    return name, tracks
