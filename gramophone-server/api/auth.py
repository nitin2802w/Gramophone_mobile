"""
Token-based auth decorator for Django views.
Mirrors the Flask @auth_required decorator from app.py.
"""

from functools import wraps
from django.http import JsonResponse
from .models import GramophoneUser


def get_token_from_request(request):
    """Extract auth token from header or query param."""
    return (
        request.headers.get('X-Auth-Token')
        or request.GET.get('token')
        or ''
    )


def auth_required(view_func):
    """
    Decorator that injects `username` kwarg into the view.
    Returns 401 if token is invalid.
    """
    @wraps(view_func)
    def wrapper(request, *args, **kwargs):
        token = get_token_from_request(request)
        username = GramophoneUser.get_by_token(token)
        if not username:
            return JsonResponse({
                'error': 'Unauthorized',
                'hint':  "Register via POST /api/register {name:'YourName'}",
            }, status=401)
        return view_func(request, *args, username=username, **kwargs)
    return wrapper
