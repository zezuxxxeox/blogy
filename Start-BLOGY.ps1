$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = "http://127.0.0.1:5174"
$AppVersion = "v=42"
$LogPath = Join-Path $ProjectDir ".server.log"
$ErrPath = Join-Path $ProjectDir ".server.err.log"

function Show-BlogyMessage {
  param(
    [string]$Message,
    [int]$Icon = 48
  )

  try {
    $shell = New-Object -ComObject WScript.Shell
    $null = $shell.Popup($Message, 0, "BLOGY", $Icon)
  } catch {
    Write-Host $Message
  }
}

function Test-BlogyServer {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 $Url
    return $response.StatusCode -eq 200 -and $response.Content -match "<title>BLOGY</title>" -and $response.Content -match $AppVersion
  } catch {
    return $false
  }
}

function Stop-BlogyServerOnPort {
  try {
    $connection = Get-NetTCPConnection -LocalPort 5174 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($connection -and $connection.OwningProcess) {
      Stop-Process -Id $connection.OwningProcess -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
    }
  } catch {
  }
}

function Get-NodePath {
  $command = Get-Command node -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    "$env:ProgramFiles\nodejs\node.exe",
    "${env:ProgramFiles(x86)}\nodejs\node.exe",
    "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

function Get-EdgePath {
  $command = Get-Command msedge -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:LOCALAPPDATA\Microsoft\Edge\Application\msedge.exe"
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate)) {
      return $candidate
    }
  }

  return $null
}

function Start-BlogyServer {
  Stop-BlogyServerOnPort

  $nodePath = Get-NodePath
  if (-not $nodePath) {
    Show-BlogyMessage "BLOGY needs Node.js to run.`nInstall Node.js, then open BLOGY again.`nhttps://nodejs.org" 16
    exit 1
  }

  Start-Process `
    -FilePath $nodePath `
    -ArgumentList "server.mjs" `
    -WorkingDirectory $ProjectDir `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogPath `
    -RedirectStandardError $ErrPath

  $deadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $deadline) {
    if (Test-BlogyServer) {
      return
    }
    Start-Sleep -Milliseconds 350
  }
}

function Start-BlogyAppWindow {
  $cacheBust = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  $appUrl = "$Url/?v=$cacheBust"
  $edgePath = Get-EdgePath

  if ($edgePath) {
    return Start-Process `
      -FilePath $edgePath `
      -ArgumentList @("--app=$appUrl", "--new-window") `
      -PassThru
  }

  return Start-Process $appUrl -PassThru
}

if (-not (Test-BlogyServer)) {
  Start-BlogyServer
}

if (-not (Test-BlogyServer)) {
  Show-BlogyMessage "BLOGY server could not start.`nCheck .server.err.log in the project folder." 16
  exit 1
}

Start-BlogyAppWindow | Out-Null
