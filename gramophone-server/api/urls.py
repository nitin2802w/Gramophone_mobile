"""
API URL routing — maps every endpoint to match the Flask app.py routes exactly.
"""

from django.urls import path
from . import views

urlpatterns = [
    # Root
    path('', views.index),

    # Public
    path('api/status', views.api_status),

    # Registration
    path('api/register', views.api_register),
    path('api/me', views.api_me),
    path('api/users', views.api_users),

    # Download
    path('api/download', views.api_download),
    path('api/download/cancel', views.api_download_cancel),
    path('api/download/stream', views.api_download_stream),
    path('api/download/status', views.api_download_status),

    # Files
    path('api/file/base64/<path:filename>', views.api_get_file_base64),
    path('api/file/chunk/<path:filename>', views.api_get_file_chunk),
    path('api/file/<path:filename>', views.api_get_file),
    path('api/files/ready', views.api_ready_files),
    path('api/files/cleanup', views.api_cleanup),

    # Admin
    path('api/server/storage', views.api_storage),
]
