#!/bin/bash
# Gramophone AWS Setup Script for Ubuntu 22.04/24.04

echo "--- Initializing Setup ---"
sudo apt update && sudo apt upgrade -y
sudo apt install -y python3-pip python3-venv ffmpeg

echo "--- Installing Dependencies ---"
# Installing globally for simplicity on a dedicated EC2 instance
pip3 install flask flask-cors mutagen pandas yt-dlp requests spotify-scraper gunicorn

echo "--- Setup Complete ---"
echo "To start the server, run:"
echo "gunicorn --bind 0.0.0.0:5000 app:app"
