$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = "http://127.0.0.1:5174"
$AppVersion = "v=26"
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

function Stop-StaleBlogyServer {
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

function Start-BlogyAppWindow {
  $cacheBust = [DateTimeOffset]::Now.ToUnixTimeSeconds()
  $appUrl = "$Url/?v=$cacheBust"
  $edgePath = Get-EdgePath

  if ($edgePath) {
    Start-Process `
      -FilePath $edgePath `
      -ArgumentList @("--app=$appUrl", "--new-window")
    return
  }

  Start-Process $appUrl
}

if (-not (Test-BlogyServer)) {
  Stop-StaleBlogyServer
  $nodePath = Get-NodePath
  if (-not $nodePath) {
    Show-BlogyMessage "BLOGY를 실행하려면 Node.js가 필요합니다.`nNode.js 설치 후 다시 실행해주세요.`nhttps://nodejs.org" 16
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
      break
    }
    Start-Sleep -Milliseconds 350
  }
}

if (-not (Test-BlogyServer)) {
  Show-BlogyMessage "BLOGY 서버를 시작하지 못했습니다.`n프로젝트 폴더의 .server.err.log를 확인해주세요." 16
  exit 1
}

Start-BlogyAppWindow
