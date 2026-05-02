#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Gramophone Server — EC2 Setup Script
#  Run this ONCE after SSH-ing into your EC2 instance
# ═══════════════════════════════════════════════════════════════════════════════

set -e

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  GRAMOPHONE SERVER — EC2 SETUP"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── System packages ──────────────────────────────────────────────────────────
echo "[1/5] Updating system packages..."
sudo apt update && sudo apt upgrade -y

echo "[2/5] Installing system dependencies..."
sudo apt install -y python3 python3-pip python3-venv ffmpeg

# ── Python virtual environment ───────────────────────────────────────────────
echo "[3/5] Creating Python virtual environment..."
cd ~/gramophone-server
python3 -m venv venv
source venv/bin/activate

echo "[4/5] Installing Python packages..."
pip install --upgrade pip
pip install -r requirements.txt

# ── Django setup ─────────────────────────────────────────────────────────────
echo "[5/5] Setting up Django..."

# Generate a proper secret key
SECRET_KEY=$(python3 -c "import secrets; print(secrets.token_urlsafe(50))")

# Create .env file
cat > .env << EOF
DJANGO_SECRET_KEY=${SECRET_KEY}
DJANGO_DEBUG=False
ADMIN_TOKEN=$(python3 -c "import secrets; print(secrets.token_urlsafe(24))")
EOF

echo "  → Generated .env with secret key"

# Run migrations (creates SQLite DB)
python manage.py migrate

# Create temp directory
mkdir -p temp

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  SETUP COMPLETE!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  To test:    source venv/bin/activate && python manage.py runserver 0.0.0.0:8000"
echo "  To deploy:  sudo bash deploy.sh"
echo ""
