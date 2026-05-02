"""
Gramophone Django Settings
==========================
Production-ready settings for AWS EC2 deployment.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY — generate a fresh key on first deploy
SECRET_KEY = os.environ.get(
    'DJANGO_SECRET_KEY',
    'django-insecure-gramophone-change-me-in-production-please'
)

DEBUG = os.environ.get('DJANGO_DEBUG', 'False').lower() in ('true', '1')

ALLOWED_HOSTS = ['*']   # EC2 public IP — restrict later if you want

INSTALLED_APPS = [
    'django.contrib.contenttypes',
    'django.contrib.auth',
    'corsheaders',
    'api',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.common.CommonMiddleware',
]

# Allow all origins (mobile app hits from any IP)
CORS_ALLOW_ALL_ORIGINS = True
CORS_ALLOW_HEADERS = [
    'content-type',
    'x-auth-token',
    'last-event-id',
    'cache-control',
    'authorization',
]

ROOT_URLCONF = 'gramophone.urls'

TEMPLATES = []

WSGI_APPLICATION = 'gramophone.wsgi.application'

# SQLite — simple, free, no RDS needed
DATABASES = {
    'default': {
        'ENGINE': 'django.db.backends.sqlite3',
        'NAME': BASE_DIR / 'db.sqlite3',
    }
}

# No password validators needed (we use token auth, not Django auth)
AUTH_PASSWORD_VALIDATORS = []

LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'Asia/Kolkata'
USE_I18N = False
USE_TZ = True

DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# ── App-specific paths ────────────────────────────────────────────────────────
TEMP_DIR = os.path.join(BASE_DIR, 'temp')
os.makedirs(TEMP_DIR, exist_ok=True)

# Admin token for protected endpoints (set via env var)
ADMIN_TOKEN = os.environ.get('ADMIN_TOKEN', '')

# Logging
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'simple': {
            'format': '[{asctime}] {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'simple',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
}
