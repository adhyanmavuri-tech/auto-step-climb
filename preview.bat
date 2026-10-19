@echo off
rem PREVIEW: your latest SimBrief flight plan, flown by a simulated aircraft, sped up, so you can see
rem the steps the real flight would fly. Nothing touches the sim. It runs in the background on its own
rem port (one above the normal one, 8788 by default). Close it with Quit app, or: stop.bat --port=8788
cd /d "%~dp0"
node src\main.ts --preview --background --open
timeout /t 5 >nul
