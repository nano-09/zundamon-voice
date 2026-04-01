#!/bin/bash

# Zundamon Voice Bot Ecosystem - macOS Stop Script
# Move to the directory where this script is located
cd "$(dirname "$0")"

echo "========================================================"
echo "    Gracefully shutting down all services...            "
echo "========================================================"
echo ""

# 1. Stop Ollama
echo "[1/4] Closing Ollama..."
osascript -e 'quit app "Ollama"' > /dev/null 2>&1
pkill -f "ollama run" > /dev/null 2>&1
pkill -f "ollama serve" > /dev/null 2>&1
pkill -f "Ollama" > /dev/null 2>&1

# 2. Stop Voicevox
echo "[2/4] Closing VOICEVOX..."
osascript -e 'quit app "VOICEVOX"' > /dev/null 2>&1

# 3. Stop Dashboard and Discord Bot
echo "[3/4] Closing Node.js processes..."
pkill -f "dashboard/server.js" > /dev/null 2>&1
pkill -f "src/index.js" > /dev/null 2>&1

echo "[4/4] Finalizing teardown..."

echo ""
echo "---------------------------------------------------"
echo "Cleanly exited all Zundamon components!"
echo "---------------------------------------------------"
sleep 2
