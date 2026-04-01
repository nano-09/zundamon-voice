#!/bin/bash

# Zundamon Voice Bot - macOS Start Script
# This script automatically prepares and runs the bot on macOS.

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
echo "Starting Zundamon Voice Bot..."
echo "Node version: $(node -v)"
echo "========================================================"

# Install or update dependencies (this will download Mac-specific binaries like ffmpeg)
echo "Ensuring dependencies are installed..."
npm install

# Start the bot
echo "Starting the bot..."
npm run start

# Keep window open if the bot crashes or stops
read -p "Bot has stopped. Press [Enter] to exit..."
