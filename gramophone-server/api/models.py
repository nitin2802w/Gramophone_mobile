"""
User model — replaces the old users.json flat-file approach.
Uses Django ORM + SQLite (free, no RDS needed).
"""

from django.db import models
import secrets
import string


def generate_token(length=32):
    alphabet = string.ascii_letters + string.digits
    return ''.join(secrets.choice(alphabet) for _ in range(length))


class GramophoneUser(models.Model):
    username   = models.CharField(max_length=30, unique=True, db_index=True)
    token      = models.CharField(max_length=64, unique=True, db_index=True)
    created    = models.DateField(auto_now_add=True)
    downloads  = models.IntegerField(default=0)

    class Meta:
        db_table = 'gramophone_users'

    def __str__(self):
        return self.username

    @classmethod
    def register(cls, name: str) -> dict:
        """Register a new user or return existing one."""
        import re
        clean = re.sub(r'[^a-z0-9_]', '', name.lower().strip())[:30]
        if not clean:
            clean = 'user'

        # Existing user — return same token (reinstall safe)
        try:
            existing = cls.objects.get(username=clean)
            return {
                'username': existing.username,
                'token':    existing.token,
                'new_user': False,
            }
        except cls.DoesNotExist:
            pass

        # Resolve name collision
        base, suffix = clean, 2
        while cls.objects.filter(username=clean).exists():
            clean = f'{base}_{suffix}'
            suffix += 1

        token = generate_token()
        user = cls.objects.create(username=clean, token=token)
        return {
            'username': user.username,
            'token':    user.token,
            'new_user': True,
        }

    @classmethod
    def get_by_token(cls, token: str):
        """Look up user by auth token. Returns username or None."""
        if not token:
            return None
        try:
            return cls.objects.get(token=token).username
        except cls.DoesNotExist:
            return None

    @classmethod
    def increment_downloads(cls, username: str):
        cls.objects.filter(username=username).update(
            downloads=models.F('downloads') + 1
        )
