@echo off
cd /d "%~dp0"
if not exist StartZundamon.exe (
    echo Preparing Zundamon Launcher...
    set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
    "%CSC%" /out:StartZundamon.exe /nologo Launcher.cs
)
if exist StartZundamon.exe (
    start StartZundamon.exe
) else (
    echo [ERROR] StartZundamon.exe creation failed.
    pause
)
