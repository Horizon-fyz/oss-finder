<#
  注册 / 更新 Windows 定时任务（两个）：
    1) 每天固定时间跑一次采集，生成当日日报
    2) 每次登录补跑一次——如果当天日报还没生成（比如 8:30 电脑没开机），就补上

  用法（需要在不受沙箱限制的普通 PowerShell 里运行，或在 DSH 里批准提权）：
    powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-task.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-task.ps1 -Time 09:15
    powershell -NoProfile -ExecutionPolicy Bypass -File .\setup-task.ps1 -Remove

  之所以用 schtasks.exe 而不是 ScheduledTasks 模块：New-ScheduledTaskAction 依赖 CIM，
  在受限环境下会报「拒绝访问」；schtasks 走 RPC，更稳。
#>
param(
  [string]$Time = '08:30',
  [string]$TaskName = 'OSS Radar Daily',
  [string]$CatchUpTaskName = 'OSS Radar Catch-up',
  [switch]$Remove
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

if ($Remove) {
  & schtasks /Delete /TN $TaskName /F 2>$null | Out-Null
  & schtasks /Delete /TN $CatchUpTaskName /F 2>$null | Out-Null
  Write-Host "已移除定时任务: $TaskName / $CatchUpTaskName"
  return
}

$dailyCmd = Join-Path $root 'run-daily.cmd'
$catchUpCmd = Join-Path $root 'run-daily-catchup.cmd'
foreach ($f in @($dailyCmd, $catchUpCmd)) {
  if (-not (Test-Path $f)) { throw "找不到脚本: $f" }
}

& schtasks /Create /SC DAILY /ST $Time /TN $TaskName /TR "`"$dailyCmd`"" /F
if ($LASTEXITCODE -ne 0) { throw "创建每日任务失败 (exit $LASTEXITCODE)" }

& schtasks /Create /SC ONLOGON /TN $CatchUpTaskName /TR "`"$catchUpCmd`"" /F
if ($LASTEXITCODE -ne 0) { Write-Warning "创建登录补跑任务失败，每日任务仍然可用" }

Write-Host ''
Write-Host "每日任务 : $TaskName  ($Time)"
Write-Host "补跑任务 : $CatchUpTaskName  (登录时)"
Write-Host ''
& schtasks /Query /TN $TaskName /FO LIST
