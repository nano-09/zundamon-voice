#!/bin/bash

# Zundamon Voice Bot Ecosystem - macOS Start Script
# This script automatically prepares and runs the bot, dashboard, and dependencies on macOS.

# Move to the directory where this script is located
cd "$(dirname "$0")"

# Check if Node.js is installed
if ! command -v node &> /dev/null
then
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

# ── Guard: do nothing if the ecosystem is already running ────────────────────
if lsof -i :3000 > /dev/null 2>&1; then
    echo "========================================================"
    echo "⚠️  Zundamon is already running (port 3000 is in use)."
    echo "    If you want to restart it, please run stop-macOS.command first."
    echo "========================================================"
    read -p "Press [Enter] to exit..."
    exit 0
fi

# Install or update dependencies
echo "Ensuring dependencies are installed..."
npm install > /dev/null

# 1. Start Voicevox (launch app)
# Assumes VOICEVOX is installed in /Applications
echo "[1/3] Starting VOICEVOX..."
open -a VOICEVOX 2>/dev/null || echo "      (Could not find VOICEVOX in Applications. Please open it manually if needed.)"

# 2. Start Dashboard Server and Bot
echo "[2/2] Starting Web Dashboard and Bot..."
echo "========================================================"
echo "Opening browser in 2 seconds..."
(sleep 2 && open http://localhost:3000) &

# Run dashboard in foreground so logs are visible
node dashboard/server.js

# Keep window open if the bot crashes or stops
read -p "Dashboard has stopped. Press [Enter] to exit..."
