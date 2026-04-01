@echo off
REM Get the path of the current directory
set "SCRIPT_DIR=%~dp0"
REM The Start script/exe we want to target
set "TARGET=%SCRIPT_DIR%StartZundamon.exe"
REM Where the shortcut will be placed
set "SHORTCUT_PATH=%USERPROFILE%\Desktop\Start Zundamon.lnk"

REM Create a temporary VBS script to generate the .lnk file
echo Set oWS = WScript.CreateObject("WScript.Shell") > create_shortcut.vbs
echo sLinkFile = "%SHORTCUT_PATH%" >> create_shortcut.vbs
echo Set oLink = oWS.CreateShortcut(sLinkFile) >> create_shortcut.vbs
echo oLink.TargetPath = "%TARGET%" >> create_shortcut.vbs
echo oLink.WorkingDirectory = "%SCRIPT_DIR%" >> create_shortcut.vbs
echo oLink.Description = "Launch the Zundamon Bot" >> create_shortcut.vbs
echo oLink.Save >> create_shortcut.vbs

REM Run the temporary VBS script
cscript /nologo create_shortcut.vbs
REM Clean up the VBS script
del create_shortcut.vbs

echo ========================================================
echo Shortcut "Start Zundamon" has been created on your Desktop!
echo You can double-click it to start the bot anywhere.
echo ========================================================
pause
