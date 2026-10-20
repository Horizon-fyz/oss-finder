@echo off
rem 登录时补跑：当天日报已存在就什么都不做
cd /d "%~dp0"
set "NODE_EXE=node"
where node >nul 2>nul || set "NODE_EXE=C:\Program Files\nodejs\node.exe"
"%NODE_EXE%" "%~dp0src\run-daily.mjs" --if-missing
