$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "BLOGY.download.lnk"
$LegacyShortcutPaths = @(
  (Join-Path $Desktop "BLOGY.lnk")
)
$BrokenLauncherPath = Join-Path $Desktop "BLOGY.download"
$BackupDir = Join-Path $ProjectDir ".launcher-backups"
$VbsPath = Join-Path $ProjectDir "BLOGY.vbs"
$IconPath = Join-Path $ProjectDir "assets\blogy-icon.ico"
$WscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"

foreach ($legacyPath in $LegacyShortcutPaths) {
  if (Test-Path -LiteralPath $legacyPath) {
    Remove-Item -LiteralPath $legacyPath -Force
  }
}

if (Test-Path -LiteralPath $BrokenLauncherPath) {
  if (-not (Test-Path -LiteralPath $BackupDir)) {
    New-Item -ItemType Directory -Path $BackupDir | Out-Null
  }

  $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $backupName = "BLOGY.download.$timestamp.bak"
  $backupPath = Join-Path $BackupDir $backupName
  Move-Item -LiteralPath $BrokenLauncherPath -Destination $backupPath -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $WscriptPath
$shortcut.Arguments = '"' + $VbsPath + '"'
$shortcut.WorkingDirectory = $ProjectDir
$shortcut.WindowStyle = 7
$shortcut.Description = "BLOGY 실행"
$shortcut.IconLocation = "$IconPath,0"
$shortcut.Save()

Write-Host "Created shortcut: $ShortcutPath"
