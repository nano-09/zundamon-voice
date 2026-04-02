#!/bin/bash

# Move to the directory where this script is located
cd "$(dirname "$0")"
SCRIPT_DIR="$(pwd)"
START_TARGET="$SCRIPT_DIR/start-macOS.command"
ICON_PATH="$SCRIPT_DIR/zundamon-icon.ico"

# Use AppleScript to create a true macOS Alias on the Desktop
osascript -e "tell application \"Finder\" to make alias file to POSIX file \"$START_TARGET\" at desktop with properties {name:\"Start Zundamon\"}" > /dev/null 2>&1

# Apply custom icon to the Start Zundamon alias using Python 3 + AppKit
ALIAS_PATH="$HOME/Desktop/Start Zundamon"
python3 - "$ICON_PATH" "$ALIAS_PATH" <<'PYEOF'
import sys
import AppKit

icon_path = sys.argv[1]
target_path = sys.argv[2]

image = AppKit.NSImage.alloc().initWithContentsOfFile_(icon_path)
if image:
    workspace = AppKit.NSWorkspace.sharedWorkspace()
    workspace.setIcon_forFile_options_(image, target_path, 0)
    print("Custom icon applied successfully.")
else:
    print("Warning: Could not load icon image. Shortcut created without custom icon.")
PYEOF

echo "========================================================"
echo "Shortcut 'Start Zundamon' has been created on your Desktop!"
echo "  ▶  Double-click it to launch the bot."
echo "========================================================"
read -p "Press [Enter] to exit..."
