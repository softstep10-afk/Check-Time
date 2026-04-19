@echo off
echo.
echo  ============================
echo   CHECK-TIME - First Time Setup
echo  ============================
echo.

REM Navigate to the folder where this bat file lives
cd /d "%~dp0"

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo  [!] Node.js is NOT installed.
    echo.
    echo  You need Node.js to run this app.
    echo  Opening the download page now...
    echo.
    echo  1. Download and install the LTS version
    echo  2. Restart your computer after installing
    echo  3. Run this SETUP.bat again
    echo.
    start https://nodejs.org
    pause
    exit /b
)

echo  [OK] Node.js found: 
node --version
echo.

REM Install dependencies
echo  Installing app dependencies... (this takes 1-2 minutes)
echo.
call npm install

if %ERRORLEVEL% neq 0 (
    echo.
    echo  [!] Something went wrong with the install.
    echo  Try deleting the node_modules folder and running SETUP.bat again.
    pause
    exit /b
)

echo.
echo  ============================
echo   SETUP COMPLETE
echo  ============================
echo.
echo  Now double-click START.bat to run the app.
echo.
pause
