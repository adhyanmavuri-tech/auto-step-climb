@echo off
rem LIVE in the background: no window. It operates the aircraft's FCU at each step point, so it asks
rem first, every time. Check on it with status.bat or the dashboard, stop it with stop.bat.
cd /d "%~dp0"
powershell -NoProfile -Command "Add-Type -AssemblyName System.Windows.Forms; $nl = [char]13 + [char]10; $m = 'Start Auto Step Climb in LIVE mode, in the background?' + $nl + $nl + 'It will operate the A330 FCU at each step point.' + $nl + 'On VATSIM or IVAO, turn on confirm each step first.'; if ([System.Windows.Forms.MessageBox]::Show($m, 'Auto Step Climb', 'YesNo', 'Warning') -ne 'Yes') { exit 1 }"
if errorlevel 1 (
  echo Cancelled. Nothing was started.
  timeout /t 3 >nul
  exit /b 1
)
node src\main.ts --live --background --open
if errorlevel 1 (
  echo.
  pause
  exit /b 1
)
timeout /t 5 >nul
