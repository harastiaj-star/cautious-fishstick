#!/usr/bin/env bash
# Rebuilds the Photoshop plugin download after you change anything in photoshop-plugin/.
#   1. Packs the plugin into Trailhead.ccx (a .ccx is a zip of the plugin folder).
#   2. Wraps Trailhead.ccx and INSTALL.txt (renamed README.txt) into downloads/trailhead-for-photoshop.zip,
#      which is what the Download the plugin button on the home page serves.
# Run from the repo root:  bash scripts/build-plugin.sh
set -euo pipefail
cd "$(dirname "$0")/.."

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

(cd photoshop-plugin && zip -q -X -r "$tmp/Trailhead.ccx" manifest.json index.html main.js aes.js qrcode.js icons)
cp photoshop-plugin/INSTALL.txt "$tmp/README.txt"

mkdir -p downloads
rm -f downloads/trailhead-for-photoshop.zip
(cd "$tmp" && zip -q -X -0 "$OLDPWD/downloads/trailhead-for-photoshop.zip" Trailhead.ccx README.txt)

echo "Built downloads/trailhead-for-photoshop.zip ($(grep -o '"version": *"[^"]*"' photoshop-plugin/manifest.json))"
