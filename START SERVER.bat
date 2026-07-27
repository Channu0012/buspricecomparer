@echo off
title BusCompare India — Server
color 0A
cls
echo.
echo  ================================================
echo   BusCompare India — Starting Server...
echo  ================================================
echo.
echo  [!] Do NOT use VS Code Live Server for this app.
echo  [!] This Node.js server is the correct way to run it.
echo.
echo  Opening browser in 3 seconds...
timeout /t 3 /nobreak >nul
start "" http://localhost:3000
echo.
node server.js
echo.
echo  [Server stopped. Press any key to exit.]
pause >nul
