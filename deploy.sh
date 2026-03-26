#!/bin/bash
set -e

SERVER_IP="${GAME_SERVER_IP:-65.108.255.161}"
PROJECT_NAME="${PROJECT_NAME:-horrorgame}"
SOURCE="${1:-dist}"

if [ ! -d "$SOURCE" ]; then
  echo "Error: '$SOURCE' directory not found. Run your build first."
  exit 1
fi

REMOTE_DIR="/var/www/games/$PROJECT_NAME"

echo "Deploying '$SOURCE/' to $SERVER_IP as /$PROJECT_NAME..."

ssh root@"$SERVER_IP" "mkdir -p $REMOTE_DIR && rm -rf $REMOTE_DIR/* $REMOTE_DIR/.*" 2>/dev/null || true
(cd "$SOURCE" && tar czf - .) | ssh root@"$SERVER_IP" "cd $REMOTE_DIR && tar xzf -"

echo "Done! Available at http://$SERVER_IP/$PROJECT_NAME/"
