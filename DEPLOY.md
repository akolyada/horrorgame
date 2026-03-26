# Deployment: Three.js Game → Hetzner CX23

## For Claude Code

This file describes how to deploy this Three.js game to a Hetzner Cloud VPS.
Read this file fully before executing any steps.

---

## Architecture

- **Server**: Hetzner CX23 (Helsinki hel1), Ubuntu 24.04 LTS
- **Web server**: Caddy (simple config, good defaults for static files)
- **Deployment method**: rsync over SSH
- **No Docker** — unnecessary overhead for serving static files
- **No HTTPS** — raw IP only (Caddy can't issue certs without a domain)

---

## Prerequisites (human does these manually)

1. Create Hetzner Cloud CX23 in hel1, Ubuntu 24.04, with SSH key
2. Note the server IP: will be referenced as `SERVER_IP` below
3. Ensure local SSH access works: `ssh root@SERVER_IP`

---

## Server setup (run once)

SSH into the server and execute:

```bash
# Update system
apt update && apt upgrade -y

# Install Caddy
apt install -y debian-keyring debian-compat curl gnupg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy

# Create web root
mkdir -p /var/www/game

# Configure Caddy for static file serving on raw IP
cat > /etc/caddy/Caddyfile << 'EOF'
:80 {
    root * /var/www/game
    file_server

    # Enable gzip/zstd compression for JS, WASM, JSON, HTML, CSS
    encode zstd gzip

    # Cache static assets aggressively (textures, models, audio)
    @assets path *.js *.css *.png *.jpg *.jpeg *.webp *.glb *.gltf *.bin *.mp3 *.ogg *.wav *.woff2
    header @assets Cache-Control "public, max-age=31536000, immutable"

    # Don't cache index.html (so deploys take effect immediately)
    @html path *.html /
    header @html Cache-Control "no-cache, no-store, must-revalidate"

    # CORS headers (in case game loads assets from other origins)
    header Access-Control-Allow-Origin "*"

    # Required for SharedArrayBuffer if using workers/threads
    header Cross-Origin-Opener-Policy "same-origin"
    header Cross-Origin-Embedder-Policy "require-corp"
}
EOF

# Restart Caddy
systemctl restart caddy
systemctl enable caddy

# Basic firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw --force enable
```

---

## Deploy from local machine

From the game repo root directory:

```bash
# Sync all game files to server (adjust source path if build output is in a subfolder)
rsync -avz --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  --exclude 'DEPLOY.md' \
  --exclude 'CLAUDE.md' \
  ./ root@SERVER_IP:/var/www/game/

# Verify
curl -I http://SERVER_IP
```

If the game's servable files are in a subfolder (e.g., `dist/`, `build/`, `public/`),
adjust the rsync source:

```bash
rsync -avz --delete ./dist/ root@SERVER_IP:/var/www/game/
```

---

## Project structure assumptions

The repo should have an `index.html` at its root (or in the build output folder)
that loads the Three.js game. Typical structure:

```
repo/
├── index.html          ← entry point
├── js/ or src/         ← game scripts
├── assets/             ← textures, models (.glb), audio
├── lib/                ← three.js and other libraries (or loaded via CDN)
├── DEPLOY.md           ← this file
└── CLAUDE.md           ← project conventions (if exists)
```

If using a bundler (vite, webpack, etc.), deploy the `dist/` output, not the source.

---

## Optional: deploy script

Create `deploy.sh` in repo root for one-command deploys:

```bash
#!/bin/bash
set -e

SERVER_IP="${GAME_SERVER_IP:?Set GAME_SERVER_IP environment variable}"
SOURCE="${1:-.}"

echo "Deploying to $SERVER_IP..."
rsync -avz --delete \
  --exclude '.git' \
  --exclude 'node_modules' \
  --exclude '.DS_Store' \
  --exclude 'DEPLOY.md' \
  --exclude 'CLAUDE.md' \
  --exclude 'deploy.sh' \
  "$SOURCE/" root@"$SERVER_IP":/var/www/game/

echo "Done! Game available at http://$SERVER_IP"
```

Usage:
```bash
export GAME_SERVER_IP=65.21.x.x
chmod +x deploy.sh
./deploy.sh          # deploy repo root
./deploy.sh dist     # deploy dist/ folder
```

---

## Later: adding a domain + HTTPS

When you get a domain, update the Caddyfile — Caddy handles Let's Encrypt automatically:

```
game.yourdomain.com {
    root * /var/www/game
    file_server
    encode zstd gzip
    # ... same headers as above
}
```

Then `systemctl restart caddy` — HTTPS just works.

---

## Troubleshooting

- **Blank page**: Check browser console. Likely a path issue — Three.js assets
  need correct relative paths. Verify `index.html` is at `/var/www/game/index.html`.
- **MIME type errors**: Caddy handles MIME types well by default. If `.glb` files
  fail, add `mime .glb application/octet-stream` to the Caddyfile.
- **Slow asset loading**: Enable browser DevTools Network tab. Large textures
  should be compressed (use .webp or KTX2/basis for Three.js).
  Caddy's `encode` directive handles gzip on-the-fly for text-based files.
- **SharedArrayBuffer errors**: The COOP/COEP headers above should fix this.
  If not needed, remove those two header lines.
