@echo off
echo.
echo  ============================
echo   CHECK-TIME - Starting App
echo  ============================
echo.

REM Navigate to the folder where this bat file lives
cd /d "%~dp0"

REM Check if node_modules exists
if not exist "node_modules" (
    echo  [!] Dependencies not installed yet.
    echo  Run SETUP.bat first.
    echo.
    pause
    exit /b
)

echo  Starting Check-Time...
echo.
echo  The app will open in your browser at:
echo  http://localhost:3000
echo.
echo  To stop the app, close this window.
echo.

REM Open browser after a short delay
start "" cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

REM Start the dev server
call npm run dev
