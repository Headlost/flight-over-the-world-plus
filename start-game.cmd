@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js is required. Install Node.js 22 or newer, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installing game dependencies...
  call npm install --no-audit --no-fund
  if errorlevel 1 (
    echo Installation failed.
    pause
    exit /b 1
  )
)

echo Starting Flight Over the World...
echo Keep this window open while playing.
call npm run start
