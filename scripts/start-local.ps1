param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$forgeRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
if (!(Test-Path -LiteralPath $nodePath)) { throw 'Node.js 24+ was not found. Install Node.js, then open Forge again.' }
Push-Location -LiteralPath $forgeRoot
try {
  $forgePortText = & $nodePath -e "const fs=require('node:fs');if(fs.existsSync('.env'))process.loadEnvFile('.env');process.stdout.write(process.env.PORT||'8787');"
  $forgePort = 0
  if (!( [int]::TryParse([string]$forgePortText, [ref]$forgePort)) -or $forgePort -lt 1 -or $forgePort -gt 65535) { throw 'PORT must be a number between 1 and 65535.' }
  $forgeUrl = "http://127.0.0.1:$forgePort"
  function Test-Forge {
    try {
      $response = Invoke-RestMethod -Uri "$forgeUrl/api/config" -TimeoutSec 2
      return ($response.mode -in @('live','paper') -and $response.sdk -and $response.balanceLabel)
    } catch { return $false }
  }
  if (!(Test-Forge)) {
    if (!(Test-Path -LiteralPath 'dist/index.html') -or !(Test-Path -LiteralPath 'dist-server/index.mjs')) { throw 'The app needs its first build. Run: pnpm install --frozen-lockfile; pnpm build; pnpm build:server' }
    $forgeLogs = Join-Path $forgeRoot 'data'
    New-Item -ItemType Directory -Force -Path $forgeLogs | Out-Null
    Start-Process -FilePath $nodePath -ArgumentList 'dist-server/index.mjs' -WorkingDirectory $forgeRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $forgeLogs 'local-server.out.log') -RedirectStandardError (Join-Path $forgeLogs 'local-server.err.log') | Out-Null
    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      if (Test-Forge) { $ready = $true; break }
      Start-Sleep -Milliseconds 200
    }
    if (!$ready) { throw "Forge did not start at $forgeUrl. Check data/local-server.err.log. Another app may be using the port." }
  }
  Write-Output "Forge is ready: $forgeUrl"
  if (!$NoOpen) { Start-Process -FilePath $forgeUrl }
} finally { Pop-Location }
