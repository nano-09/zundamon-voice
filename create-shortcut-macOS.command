#!/bin/bash

# Move to the directory where this script is located
cd "$(dirname "$0")"
START_TARGET="$(pwd)/start-macOS.command"
STOP_TARGET="$(pwd)/stop-macOS.command"

# Use AppleScript to create true macOS Aliases on the Desktop
osascript -e "tell application \"Finder\" to make alias file to POSIX file \"$START_TARGET\" at desktop with properties {name:\"Start Zundamon\"}" > /dev/null 2>&1
osascript -e "tell application \"Finder\" to make alias file to POSIX file \"$STOP_TARGET\" at desktop with properties {name:\"Stop Zundamon\"}" > /dev/null 2>&1

echo "========================================================"
echo "Two shortcuts have been created on your Desktop:"
echo "  ▶  'Start Zundamon' - double-click to launch the bot"
echo "  ⏹  'Stop Zundamon'  - double-click to shut everything down"
echo "========================================================"
read -p "Press [Enter] to exit..."
