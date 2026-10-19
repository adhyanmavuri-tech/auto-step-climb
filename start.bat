@echo off
rem DRY RUN: reads the sim and shows what it would do. Sends nothing to the sim.
cd /d "%~dp0"
echo Auto Step Climb - dry run (nothing is sent to the sim)
echo Dashboard: http://127.0.0.1:8787
echo.
node src\main.ts
pause
