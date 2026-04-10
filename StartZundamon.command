#!/bin/bash

# Zundamon Voice Bot Ecosystem - macOS Start Script
# This script automatically prepares and runs the bot, dashboard, and dependencies on macOS.

cd "$(dirname "$0")"

if ! command -v node &> /dev/null; then
    echo "========================================================"
    echo "Error: Node.js is not installed."
    echo "Please download and install Node.js from https://nodejs.org/"
    echo "========================================================"
    read -p "Press [Enter] to exit..."
    exit 1
fi

echo "========================================================"
echo "Starting Zundamon Ecosystem..."
echo "Node version: $(node -v)"
echo "========================================================"

# Guard: already running?
if lsof -i :3000 > /dev/null 2>&1; then
    echo "========================================================"
    echo "⚠️  Zundamon is already running (port 3000 is in use)."
    echo "    If you want to restart it, please run ShutdownZundamon.command first."
    echo "========================================================"
    read -p "Press [Enter] to exit..."
    exit 0
fi

echo "Ensuring dependencies are up to date..."
npm install > /dev/null

echo "[1/2] Starting VOICEVOX..."
open -a VOICEVOX 2>/dev/null || echo "      (Could not find VOICEVOX in Applications. Please open it manually if needed.)"

echo "[2/2] Starting Web Dashboard and Bot..."
echo "========================================================"
echo "Opening browser in 2 seconds..."
(sleep 2 && open http://localhost:3000) &

node dashboard/server.js

read -p "Dashboard has stopped. Press [Enter] to exit..."
