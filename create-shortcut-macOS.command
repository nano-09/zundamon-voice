#!/bin/bash

# Move to the directory where this script is located
cd "$(dirname "$0")"
TARGET="$(pwd)/start-macOS.command"

# Use AppleScript to create a true macOS Alias on the Desktop
osascript -e "tell application \"Finder\" to make alias file to POSIX file \"$TARGET\" at desktop with properties {name:\"Start Zundamon\"}" > /dev/null 2>&1

echo "========================================================"
echo "Shortcut 'Start Zundamon' has been created on your Desktop!"
echo "You can double-click it to start the bot anywhere."
echo "========================================================"
read -p "Press [Enter] to exit..."
