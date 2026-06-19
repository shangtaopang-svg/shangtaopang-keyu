#!/bin/bash
# Deploy script for shangtaopang-keyu
set -e

DIR="/opt/shangtaopang-keyu"
echo "[deploy] Starting deploy at $(date)"

if [ ! -d "$DIR" ]; then
  echo "[deploy] ERROR: Directory $DIR does not exist"
  exit 1
fi

cd "$DIR"
echo "[deploy] Pulling latest code..."
git pull origin master

echo "[deploy] Installing dependencies..."
PUPPETEER_SKIP_DOWNLOAD=true npm install --omit=dev 2>&1

echo "[deploy] Restarting PM2..."
pm2 restart ai-learning 2>&1

echo "[deploy] Deploy complete!"
