@echo off
rem ============================================================================
rem  Virtual Laboratory - launcher for Windows
rem  Requires: Node.js >= 18 (https://nodejs.org)
rem
rem  Usage: double-click start.bat, or run from cmd:
rem         start.bat            -> http://localhost:8080
rem         set PORT=9000 & start.bat
rem ============================================================================
cd /d %~dp0

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Install it from https://nodejs.org and try again.
  pause
  exit /b 1
)

if not exist node_modules (
  echo [1/3] Installing dependencies...
  call npm install --no-audit --no-fund
)

echo [2/3] Seeding the database...
call node server\seed.js

echo [3/3] Starting Virtual Laboratory on http://localhost:%PORT%
echo       Press Ctrl+C to stop.
node server\server.js
pause
