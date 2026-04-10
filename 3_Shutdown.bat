@echo off
title Zundamon Silent Shutdown
color 0A
echo ===================================================
echo     Gracefully shutting down all services...
echo ===================================================
echo.

:: ── Guard: do nothing if the ecosystem is already stopped ───────────────────
netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    tasklist /FI "IMAGENAME eq node.exe" 2>nul | findstr /i node.exe >nul 2>&1
    if errorlevel 1 (
        echo ===================================================
        echo  [i] Zundamon is not running. Nothing to stop.
        echo ===================================================
        timeout /t 3 >nul
        exit
    )
)

:: 1. Stop Dashboard and Discord Bot (Node.js processes)
echo [1/3] Closing Dashboard and Discord Bot...
taskkill /F /FI "IMAGENAME eq node.exe" /T >nul 2>&1

:: Wait and free port 3000 if still busy
timeout /t 2 >nul
for /l %%i in (1,1,3) do (
    netstat -ano | findstr ":3000 " | findstr "LISTENING" >nul 2>&1
    if not errorlevel 1 (
        echo       (Port 3000 still busy, force-killing... %%i/3)
        for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":3000 " ^| findstr "LISTENING"') do taskkill /F /PID %%p >nul 2>&1
        timeout /t 1 >nul
    )
)

:: 2. Stop Ollama
echo [2/3] Closing Ollama...
taskkill /F /IM "ollama.exe" /T >nul 2>&1
taskkill /F /IM "ollama_app.exe" /T >nul 2>&1

:: 3. Stop Voicevox
echo [3/3] Closing VOICEVOX...
taskkill /F /IM "VOICEVOX.exe" /T >nul 2>&1

echo.
echo ---------------------------------------------------
echo Cleanly exited all Zundamon components!
echo ---------------------------------------------------
timeout /t 3 >nul
exit
