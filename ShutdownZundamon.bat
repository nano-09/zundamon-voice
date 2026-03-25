@echo off
title Zundamon Silent Shutdown
color 0A
echo ===================================================
echo     Gracefully shutting down all services...
echo ===================================================
echo.

:: 1. Stop AI Core Services
echo [1/4] Closing Ollama...
taskkill /F /IM "ollama.exe" /T >nul 2>&1
taskkill /F /IM "ollama_app.exe" /T >nul 2>&1

:: 2. Stop Voice Synthesis
echo [2/4] Closing VOICEVOX...
taskkill /F /IM "VOICEVOX.exe" /T >nul 2>&1

:: 3. Stop Dashboard and Discord Bot
echo [3/4] Closing Node.js processes...
:: Targeted taskkill for node processes running the dashboard or bot
taskkill /F /FI "IMAGENAME eq node.exe" /T >nul 2>&1

echo [4/4] Finalizing teardown...
:: The Dashboard CMD window will automatically close itself because of the `/c` flag in Launcher.cs

echo.
echo ---------------------------------------------------
echo Cleanly exited all Zundamon components!
echo ---------------------------------------------------
timeout /t 3 >nul
exit
