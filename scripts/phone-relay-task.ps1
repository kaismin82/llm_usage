# Scheduled-task wrapper: allows the Tailscale Serve reader host and runs the relay hidden.
$ErrorActionPreference = 'Stop'
$env:LLM_PHONE_HOSTS = 'minholee-home.tail2f2c00.ts.net'
Set-Location (Join-Path $PSScriptRoot '..')
$bun = Join-Path $env:USERPROFILE '.bun\bin\bun.exe'
$logDir = Join-Path $env:LOCALAPPDATA 'LLMUsagePhone'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
& $bun 'scripts\phone-relay.ts' *>> (Join-Path $logDir 'relay.log')