@echo off
rem 每日更新：扫荡新项目 + HN 信号 + 刷新 watchlist 真实星数（约 2 分钟）
cd /d "%~dp0"
set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=C:\Program Files\nodejs\node.exe"
"%NODE_EXE%" "%~dp0oss.mjs" daily
