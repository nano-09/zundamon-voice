@echo off
echo ========================================================
echo Compiling Launcher.cs to StartZundamon.exe...
echo ========================================================
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"

if exist "%CSC%" (
    "%CSC%" /out:StartZundamon.exe /nologo Launcher.cs
    if %errorlevel% equ 0 (
        echo.
        echo Successfully compiled StartZundamon.exe!
        echo You can now use the updated launcher.
    ) else (
        echo.
        echo Compilation failed. Please check the errors above.
    )
) else (
    echo.
    echo Could not find csc.exe compiler. Cannot compile.
    echo You may need to install the .NET Framework.
)
echo.
pause
