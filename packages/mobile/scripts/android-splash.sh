#!/usr/bin/env bash
# Builds assets/splash-android.png from assets/splash.png.
# Android 12+ shows the splash image as an icon and crops it to the inner circle
# (2/3 of the square), so the logo is shrunk to 600/1024 wide and centred to fit inside it.
set -euo pipefail
cd "$(dirname "$0")/.."
magick assets/splash.png -trim +repage -resize 600x \
  -background none -gravity center -extent 1024x1024 \
  -strip -define png:exclude-chunks=date,time assets/splash-android.png
