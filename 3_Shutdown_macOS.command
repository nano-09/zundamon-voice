#!/bin/bash

# Zundamon Voice Bot Ecosystem - macOS Stop Script
# Move to the directory where this script is located
cd "$(dirname "$0")"

echo "========================================================"
echo "    Gracefully shutting down all services...            "
echo "========================================================"
echo ""

# ── Guard: do nothing if the ecosystem is already stopped ───────────────────
if ! lsof -i :3000 > /dev/null 2>&1 && \
   ! pgrep -f "dashboard/server.js" > /dev/null 2>&1 && \
   ! pgrep -f "src/index.js" > /dev/null 2>&1; then
    echo "========================================================"
    echo "ℹ️  Zundamon is not running. Nothing to stop."
    echo "========================================================"
    sleep 1
    exit 0
fi

# ── Helper: kill all PIDs holding a given port ──────────────────────────────
kill_port() {
    local port=$1
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "      (Force-releasing port $port, PIDs: $pids)"
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
}

# 1. Stop Dashboard (graceful SIGTERM first, then SIGKILL)
echo "[1/4] Closing Dashboard..."
pkill -TERM -f "dashboard/server.js" > /dev/null 2>&1
sleep 1
pkill -KILL -f "dashboard/server.js" > /dev/null 2>&1

# 2. Stop Discord Bot
echo "[2/4] Closing Discord Bot..."
pkill -TERM -f "src/index.js" > /dev/null 2>&1
sleep 1
pkill -KILL -f "src/index.js" > /dev/null 2>&1

# Ensure port 3000 is actually free
for i in 1 2 3; do
    if lsof -i :3000 > /dev/null 2>&1; then
        echo "      (Port 3000 still busy, force-killing... $i/3)"
        kill_port 3000
        sleep 1
    else
        break
    fi
done

if lsof -i :3000 > /dev/null 2>&1; then
    echo "      ⚠️  Port 3000 could not be freed. You may need to reboot."
else
    echo "      ✅ Port 3000 is free."
fi

# 3. Stop Voicevox
echo "[3/3] Closing VOICEVOX..."
osascript -e 'quit app "VOICEVOX"' > /dev/null 2>&1

echo ""
echo "---------------------------------------------------"
echo "Cleanly exited all Zundamon components!"
echo "---------------------------------------------------"
sleep 1
