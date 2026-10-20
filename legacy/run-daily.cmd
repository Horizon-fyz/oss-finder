@echo off
rem 手动运行入口 / 定时任务备选入口
cd /d "%~dp0"
set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=C:\Program Files\nodejs\node.exe"
"%NODE_EXE%" "%~dp0src\run-daily.mjs" %*
