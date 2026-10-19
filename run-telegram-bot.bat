@echo off
cd /d "%~dp0"
if not exist node_modules (echo Installing, please wait... & call npm install)
call npm run bot
pause
