param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$forgeRoot = Split-Path -Parent $PSScriptRoot
$nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe' }
if (!(Test-Path -LiteralPath $nodePath)) { throw 'Node.js 24+ was not found. Install Node.js, then open Forge again.' }
$env:PATH = "$(Split-Path -Parent $nodePath);$env:PATH"
Push-Location -LiteralPath $forgeRoot
try {
  & $nodePath -e "const [major,minor]=process.versions.node.split('.').map(Number);if(major<24||(major===24&&minor<2)){console.error('Forge requires Node.js 24.2 or newer.');process.exit(1)}"
  if ($LASTEXITCODE -ne 0) { throw 'Update Node.js to version 24.2 or newer, then open Forge again.' }
  $forgePortText = & $nodePath -e "const fs=require('node:fs');if(fs.existsSync('.env'))process.loadEnvFile('.env');process.stdout.write(process.env.PORT||'8787');"
  if ($LASTEXITCODE -ne 0) { throw 'Could not read the Forge configuration. Check .env syntax.' }
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
    # Git intentionally excludes build output and dependencies. Prepare a fresh clone here.
    $needsBuild = !(Test-Path -LiteralPath 'dist/index.html') -or !(Test-Path -LiteralPath 'dist-server/index.mjs') -or !(Test-Path -LiteralPath 'node_modules/.modules.yaml')
    if (!$needsBuild) {
      $lastBuild = @((Get-Item 'dist/index.html').LastWriteTimeUtc, (Get-Item 'dist-server/index.mjs').LastWriteTimeUtc) | Sort-Object | Select-Object -First 1
      $buildInputs = @(Get-ChildItem -LiteralPath 'src','server' -File -Recurse) + @(Get-Item 'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','vite.config.ts','index.html') + @(Get-ChildItem -LiteralPath 'public' -File -Recurse)
      $needsBuild = @($buildInputs | Where-Object { $_.LastWriteTimeUtc -gt $lastBuild }).Count -gt 0
    }
    if ($needsBuild) {
      $pnpmCommand = Get-Command pnpm.cmd -ErrorAction SilentlyContinue
      $bundledPnpm = Join-Path $env:USERPROFILE '.cache/codex-runtimes/codex-primary-runtime/dependencies/bin/fallback/pnpm.cmd'
      $packageArgs = @()
      if ($pnpmCommand) { $packagePath = $pnpmCommand.Source }
      elseif (Test-Path -LiteralPath $bundledPnpm) { $packagePath = $bundledPnpm }
      else {
        $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (!$npmCommand) { throw 'Install Node.js 24+ with npm, then open Forge again.' }
        $packagePath = $npmCommand.Source
        $packageArgs = @('exec','--yes','--package=pnpm@11.25.0','--','pnpm')
      }
      Write-Output 'Preparing Forge. The first run downloads dependencies and builds the app.'
      & $packagePath @packageArgs install --frozen-lockfile
      if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection and open Forge again.' }
      & $packagePath @packageArgs run build
      if ($LASTEXITCODE -ne 0) { throw 'Forge client build failed. See the build error above.' }
      & $packagePath @packageArgs run build:server
      if ($LASTEXITCODE -ne 0) { throw 'Forge server build failed. See the build error above.' }
    }
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
