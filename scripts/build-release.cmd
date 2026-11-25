@echo off
cd /d "%~dp0\.."
node scripts\release.mjs all
exit /b %errorlevel%
