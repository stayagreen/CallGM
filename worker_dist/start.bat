@echo off
title AI Studio Worker Node
echo ===================================================
echo   AI 自动化分布式 Worker 启动器 (守护进程)
echo ===================================================
:loop
npx tsx worker.ts
if %errorlevel% equ 99 goto stop
echo.
echo [System] Worker 进程已退出，正在自动重启...
timeout /t 3
goto loop

:stop
echo.
echo [System] 收到主服务器永久停止指令，Worker 退出。
pause
