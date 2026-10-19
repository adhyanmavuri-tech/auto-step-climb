@echo off
rem DRY RUN in the background: no window. It reads the sim and logs what it would do; nothing is sent.
rem Check on it with status.bat or the dashboard, stop it with stop.bat.
cd /d "%~dp0"
node src\main.ts --background --open
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
timeout /t 5 >nul
