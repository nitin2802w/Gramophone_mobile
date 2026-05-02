"""
Gramophone API Views — all endpoints ported from Flask app.py to Django.

Every endpoint has the exact same path and behavior as the Flask version
so the mobile app works without any API changes.
"""

import os
import json
import base64
import threading

from django.http import JsonResponse, HttpResponse, FileResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_GET, require_POST
from django.conf import settings

from .models import GramophoneUser
from .auth import auth_required, get_token_from_request
from .downloader import get_user_state, download_thread


# ══════════════════════════════════════════════════════════════════════════════
#  ROOT
# ══════════════════════════════════════════════════════════════════════════════
@require_GET
def index(request):
    return JsonResponse({
        'status': 'Gramophone Server v5.0 (Django)',
        'tip':    "POST /api/register {name:'YourName'} to get started",
    })


# ══════════════════════════════════════════════════════════════════════════════
#  STATUS (public)
# ══════════════════════════════════════════════════════════════════════════════
@require_GET
def api_status(request):
    user_count = GramophoneUser.objects.count()
    return JsonResponse({
        'ok':      True,
        'server':  'Gramophone AWS Server',
        'version': '5.0',
        'users':   user_count,
    })


# ══════════════════════════════════════════════════════════════════════════════
#  REGISTRATION
# ══════════════════════════════════════════════════════════════════════════════
@csrf_exempt
@require_POST
def api_register(request):
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        data = {}

    name = data.get('name', '').strip()
    if not name:
        return JsonResponse({'error': 'Name is required'}, status=400)
    if len(name) > 50:
        return JsonResponse({'error': 'Name too long (max 50 chars)'}, status=400)

    result = GramophoneUser.register(name)
    status_code = 201 if result['new_user'] else 200

    # Create user temp dir
    user_temp = os.path.join(settings.TEMP_DIR, result['username'])
    os.makedirs(user_temp, exist_ok=True)

    return JsonResponse(result, status=status_code)


@require_GET
@auth_required
def api_me(request, username):
    try:
        user = GramophoneUser.objects.get(username=username)
        return JsonResponse({
            'username':  user.username,
            'created':   user.created.strftime('%Y-%m-%d'),
            'downloads': user.downloads,
        })
    except GramophoneUser.DoesNotExist:
        return JsonResponse({'error': 'User not found'}, status=404)


@require_GET
def api_users(request):
    """List all users — requires ADMIN_TOKEN env var."""
    admin = settings.ADMIN_TOKEN
    if admin and get_token_from_request(request) != admin:
        return JsonResponse({'error': 'Admin access only'}, status=401)

    users = GramophoneUser.objects.all()
    return JsonResponse({
        'count': users.count(),
        'users': [
            {
                'username':  u.username,
                'created':   u.created.strftime('%Y-%m-%d'),
                'downloads': u.downloads,
            }
            for u in users
        ],
    })


# ══════════════════════════════════════════════════════════════════════════════
#  DOWNLOAD ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════
@csrf_exempt
@require_POST
@auth_required
def api_download(request, username):
    """Start downloading a Spotify playlist."""
    try:
        data = json.loads(request.body)
    except (json.JSONDecodeError, ValueError):
        data = {}

    url   = data.get('url', '').strip()
    force = bool(data.get('force', False))
    if not url:
        return JsonResponse({'error': 'No URL provided'}, status=400)

    state = get_user_state(username)
    if state['downloading']:
        if not force:
            return JsonResponse({
                'error': 'Already downloading',
                'hint':  'Pass force=true to cancel the stuck session and restart',
            }, status=409)
        print(f'[Download] Force-reset for {username}', flush=True)
        state['downloading'] = False

    state['downloading']   = True
    state['ready_files']   = []
    state['current_track'] = ''
    state['progress']      = 0
    with state['condition']:
        state['events'] = []

    threading.Thread(
        target=download_thread,
        args=(url, username),
        daemon=True,
    ).start()

    return JsonResponse({'ok': True, 'message': 'Download started'})


@csrf_exempt
@require_POST
@auth_required
def api_download_cancel(request, username):
    """Cancel / reset a stuck download session."""
    state = get_user_state(username)
    with state['condition']:
        state['downloading']   = False
        state['current_track'] = ''
        state['progress']      = 0
        state['ready_files']   = []
        state['events'].append({'type': 'done'})
        state['condition'].notify_all()

    print(f'[Cancel] Download reset for {username}', flush=True)
    return JsonResponse({'ok': True, 'message': 'Download cancelled'})


@require_GET
@auth_required
def api_download_stream(request, username):
    """
    SSE-style stream — phone polls here for live download progress.
    Returns events as text/plain (same format as Flask version).
    """
    state = get_user_state(username)

    last_id_str = request.headers.get('Last-Event-Id', '')
    index = int(last_id_str) if last_id_str.isdigit() else 0

    with state['condition']:
        if len(state['events']) <= index:
            state['condition'].wait(timeout=10)
        new_events = state['events'][index:]

    if not new_events:
        text_resp = 'data: {"type":"ping"}\n\n'
    else:
        text_lines = []
        for i, msg in enumerate(new_events):
            event_id = index + i
            text_lines.append(f'id: {event_id}')
            text_lines.append(f'data: {json.dumps(msg, ensure_ascii=False)}')
            text_lines.append('')
            text_lines.append('')
        text_resp = '\n'.join(text_lines)

    return HttpResponse(
        text_resp,
        content_type='text/plain',
        headers={'Cache-Control': 'no-cache'},
    )


@require_GET
@auth_required
def api_download_status(request, username):
    s = get_user_state(username)
    return JsonResponse({
        'downloading':   s['downloading'],
        'current_track': s['current_track'],
        'progress':      s['progress'],
        'total':         s['total'],
        'playlist_name': s['playlist_name'],
        'ready_count':   len(s['ready_files']),
    })


# ══════════════════════════════════════════════════════════════════════════════
#  FILE ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════
@require_GET
@auth_required
def api_get_file(request, username, filename):
    """Download a file to phone."""
    user_temp = os.path.join(settings.TEMP_DIR, username)
    file_path = os.path.join(user_temp, filename)

    # Security: prevent path traversal
    if not os.path.abspath(file_path).startswith(
            os.path.abspath(user_temp) + os.sep):
        return JsonResponse({'error': 'Invalid path'}, status=400)

    if not os.path.exists(file_path):
        return JsonResponse({'error': 'File not found'}, status=404)

    lower = filename.lower()
    if lower.endswith('.mp3'):
        mime = 'audio/mpeg'
    elif lower.endswith(('.jpg', '.jpeg')):
        mime = 'image/jpeg'
    else:
        mime = 'application/octet-stream'

    try:
        with open(file_path, 'rb') as f:
            data = f.read()

        response = HttpResponse(data, content_type=mime)
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        response['Content-Length'] = str(len(data))
        response['Accept-Ranges'] = 'none'
        return response
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@require_GET
@auth_required
def api_get_file_base64(request, username, filename):
    user_temp = os.path.join(settings.TEMP_DIR, username)
    file_path = os.path.join(user_temp, filename)

    if not os.path.abspath(file_path).startswith(
            os.path.abspath(user_temp) + os.sep):
        return JsonResponse({'error': 'Invalid path'}, status=400)

    if not os.path.exists(file_path):
        return JsonResponse({'error': 'File not found'}, status=404)

    try:
        with open(file_path, 'rb') as f:
            encoded = base64.b64encode(f.read()).decode('utf-8')
        return JsonResponse({'data': encoded})
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@require_GET
@auth_required
def api_get_file_chunk(request, username, filename):
    user_temp = os.path.join(settings.TEMP_DIR, username)
    file_path = os.path.join(user_temp, filename)

    if not os.path.abspath(file_path).startswith(
            os.path.abspath(user_temp) + os.sep):
        return JsonResponse({'error': 'Invalid path'}, status=400)

    if not os.path.exists(file_path):
        return JsonResponse({'error': 'File not found'}, status=404)

    try:
        offset = int(request.GET.get('offset', '0'))
        length = int(request.GET.get('length', str(256 * 1024)))
    except ValueError:
        return JsonResponse({'error': 'Invalid offset/length'}, status=400)

    if offset < 0 or length <= 0:
        return JsonResponse({'error': 'Invalid offset/length'}, status=400)

    total_size = os.path.getsize(file_path)
    if offset >= total_size:
        return JsonResponse(
            {'error': 'Offset out of range', 'size': total_size}, status=416)

    lower = filename.lower()
    if lower.endswith('.mp3'):
        mime = 'audio/mpeg'
    elif lower.endswith(('.jpg', '.jpeg')):
        mime = 'image/jpeg'
    else:
        mime = 'application/octet-stream'

    try:
        with open(file_path, 'rb') as f:
            f.seek(offset)
            chunk = f.read(length)

        response = HttpResponse(chunk, content_type=mime)
        response['Content-Length']  = str(len(chunk))
        response['X-File-Size']    = str(total_size)
        response['X-Chunk-Offset'] = str(offset)
        response['X-Chunk-Length'] = str(len(chunk))
        response['X-File-Name']   = filename
        response['Accept-Ranges']  = 'bytes'
        return response
    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


@require_GET
@auth_required
def api_ready_files(request, username):
    """List files ready to pull."""
    state = get_user_state(username)
    return JsonResponse({
        'ready': state['ready_files'],
        'count': len(state['ready_files']),
    })


@csrf_exempt
@require_POST
@auth_required
def api_cleanup(request, username):
    """Delete all remaining temp files for this user."""
    user_temp = os.path.join(settings.TEMP_DIR, username)
    deleted = 0
    if os.path.isdir(user_temp):
        for f in os.listdir(user_temp):
            try:
                os.remove(os.path.join(user_temp, f))
                deleted += 1
            except Exception:
                pass
    get_user_state(username)['ready_files'] = []
    return JsonResponse({'ok': True, 'deleted': deleted})


# ══════════════════════════════════════════════════════════════════════════════
#  ADMIN ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════
@require_GET
def api_storage(request):
    admin = settings.ADMIN_TOKEN
    if admin and get_token_from_request(request) != admin:
        return JsonResponse({'error': 'Admin only'}, status=401)

    total, count = 0, 0
    for root, _, files in os.walk(settings.TEMP_DIR):
        for f in files:
            try:
                total += os.path.getsize(os.path.join(root, f))
                count += 1
            except Exception:
                pass
    return JsonResponse({
        'temp_files':   count,
        'temp_size_mb': round(total / 1024 / 1024, 2),
    })
