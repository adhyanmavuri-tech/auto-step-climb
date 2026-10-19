@echo off
rem LIVE: operates the aircraft's FCU in the sim when a step point is reached.
cd /d "%~dp0"
echo.
echo  LIVE MODE - Auto Step Climb will operate the FCU at each step point.
echo  On VATSIM/IVAO, turn on "confirm each step" first and get your step clearance.
echo  Press Ctrl+C or close this window to stop.
echo.
pause
node src\main.ts --live
pause
