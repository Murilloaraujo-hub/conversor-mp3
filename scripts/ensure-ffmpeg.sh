#!/bin/bash
# Ensure FFmpeg is installed
if ! command -v ffmpeg &> /dev/null || ! command -v ffprobe &> /dev/null; then
    echo "Installing FFmpeg..."
    sudo apt-get update -qq && sudo apt-get install -y -qq ffmpeg 2>/dev/null || true
fi

if ! command -v yt-dlp &> /dev/null; then
    echo "Installing yt-dlp..."
    pip3 install --break-system-packages yt-dlp 2>/dev/null || true
fi

echo "FFmpeg: $(which ffmpeg 2>/dev/null || echo 'not found')"
echo "ffprobe: $(which ffprobe 2>/dev/null || echo 'not found')"
echo "yt-dlp: $(which yt-dlp 2>/dev/null || echo 'not found')"
