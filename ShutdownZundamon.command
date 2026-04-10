#!/bin/bash

# Zundamon Voice Bot Ecosystem - macOS Stop Script
cd "$(dirname "$0")"

echo "========================================================"
echo "    Gracefully shutting down all services...            "
echo "========================================================"
echo ""

if ! lsof -i :3000 > /dev/null 2>&1 && \
   ! pgrep -f "dashboard/server.js" > /dev/null 2>&1 && \
   ! pgrep -f "src/index.js" > /dev/null 2>&1; then
    echo "========================================================"
    echo "ℹ️  Zundamon is not running. Nothing to stop."
    echo "========================================================"
    sleep 1
    exit 0
fi

kill_port() {
    local port=$1
    local pids
    pids=$(lsof -ti :"$port" 2>/dev/null)
    if [ -n "$pids" ]; then
        echo "      (Force-releasing port $port, PIDs: $pids)"
        echo "$pids" | xargs kill -9 2>/dev/null || true
    fi
}

echo "[1/3] Closing Dashboard..."
pkill -TERM -f "dashboard/server.js" > /dev/null 2>&1
sleep 1
pkill -KILL -f "dashboard/server.js" > /dev/null 2>&1

echo "[2/3] Closing Discord Bot..."
pkill -TERM -f "src/index.js" > /dev/null 2>&1
sleep 1
pkill -KILL -f "src/index.js" > /dev/null 2>&1

# Ensure port 3000 is free
for i in 1 2 3; do
    if lsof -i :3000 > /dev/null 2>&1; then
        echo "      (Port 3000 still busy, force-killing... $i/3)"
        kill_port 3000
        sleep 1
    else
        break
    fi
done

echo "[3/3] Closing VOICEVOX..."
osascript -e 'quit app "VOICEVOX"' > /dev/null 2>&1

echo ""
echo "---------------------------------------------------"
echo "Cleanly exited all Zundamon components!"
echo "---------------------------------------------------"
sleep 1
