$ErrorActionPreference = "Stop"

$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
& (Join-Path $ProjectDir "Start-BLOGY.ps1")
