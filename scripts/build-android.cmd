@echo off
cd /d "%~dp0\.."
node scripts\release.mjs android %*
exit /b %errorlevel%
