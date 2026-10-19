@echo off
rem Stops the app, whether it runs in the background or in a console window.
rem It refuses while a step is in progress: press Stop on the dashboard first.
cd /d "%~dp0"
node scripts\stop.ts %*
timeout /t 4 >nul
