@echo off
cd /d "%~dp0"
if not exist node_modules (echo Installing, please wait... & call npm install)
echo Open http://localhost:5173 in your browser when it says Local.
call npm run dev:all
pause
