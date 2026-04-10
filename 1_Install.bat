@echo off
cd /d "%~dp0"
echo ------------------------------------------
echo Preparing Zundamon Installer...
echo ------------------------------------------
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if not exist "%CSC%" (
    echo [ERROR] .NET Framework csc.exe not found.
    pause
    exit /b 1
)

"%CSC%" /out:SetupZundamon.exe /nologo Installer.cs
if %errorlevel% neq 0 (
    echo [ERROR] Compilation failed.
    pause
    exit /b 1
)

SetupZundamon.exe
