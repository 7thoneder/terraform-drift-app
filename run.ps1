$ErrorActionPreference = "Stop"

$python = "python"
if (Test-Path "C:\Users\henx_\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe") {
  $python = "C:\Users\henx_\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
}

& $python "$PSScriptRoot\server.py"

