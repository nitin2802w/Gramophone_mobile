#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════════
#  Gramophone Server — Deploy as systemd service
#  Run with:  sudo bash deploy.sh
#  This makes the server auto-start on boot and stay running 24/7
# ═══════════════════════════════════════════════════════════════════════════════

set -e

WORKDIR="/home/ubuntu/gramophone-server"
VENV="${WORKDIR}/venv"

# Load env vars
if [ -f "${WORKDIR}/.env" ]; then
    export $(grep -v '^#' "${WORKDIR}/.env" | xargs)
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  DEPLOYING GRAMOPHONE AS SYSTEMD SERVICE"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── Create systemd service ───────────────────────────────────────────────────
cat > /etc/systemd/system/gramophone.service << EOF
[Unit]
Description=Gramophone Music Server
After=network.target

[Service]
Type=simple
User=ubuntu
WorkingDirectory=${WORKDIR}
EnvironmentFile=${WORKDIR}/.env
ExecStart=${VENV}/bin/gunicorn \\
    --bind 0.0.0.0:8000 \\
    --workers 2 \\
    --threads 4 \\
    --timeout 300 \\
    --access-logfile - \\
    --error-logfile - \\
    gramophone.wsgi:application
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "  → Created systemd service file"

# ── Enable and start ─────────────────────────────────────────────────────────
systemctl daemon-reload
systemctl enable gramophone
systemctl restart gramophone

echo "  → Service started!"
echo ""

# ── Check status ─────────────────────────────────────────────────────────────
sleep 2
systemctl status gramophone --no-pager || true

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  DEPLOYMENT COMPLETE!"
echo "═══════════════════════════════════════════════════════"
echo ""
echo "  Server URL:  http://$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo 'YOUR_IP'):8000"
echo ""
echo "  Commands:"
echo "    sudo systemctl status gramophone     # check status"
echo "    sudo systemctl restart gramophone    # restart"
echo "    sudo journalctl -u gramophone -f     # view logs"
echo ""
