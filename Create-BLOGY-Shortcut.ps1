$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "BLOGY.lnk"
$OldShortcutPath = Join-Path $Desktop "Easy Posting Studio.lnk"
$VbsPath = Join-Path $ProjectDir "BLOGY.vbs"
$IconPath = Join-Path $ProjectDir "assets\blogy-icon.ico"
$WscriptPath = Join-Path $env:SystemRoot "System32\wscript.exe"

if (Test-Path -LiteralPath $OldShortcutPath) {
  Remove-Item -LiteralPath $OldShortcutPath -Force
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($ShortcutPath)
$shortcut.TargetPath = $WscriptPath
$shortcut.Arguments = '"' + $VbsPath + '"'
$shortcut.WorkingDirectory = $ProjectDir
$shortcut.WindowStyle = 7
$shortcut.Description = "BLOGY 실행"
$shortcut.IconLocation = $IconPath
$shortcut.Save()

Write-Host "Created shortcut: $ShortcutPath"
