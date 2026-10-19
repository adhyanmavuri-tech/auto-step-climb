@echo off
rem Says whether the app is running and what it is doing. Read-only.
cd /d "%~dp0"
node scripts\status.ts %*
pause
