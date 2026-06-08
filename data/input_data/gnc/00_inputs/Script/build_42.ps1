param(
  [int]$Jobs = 4,
  [switch]$ForceRebuild,
  [switch]$Gui
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'build_42.py'
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $python) {
  throw 'Python is required to run build_42.py'
}

$args = @($script, '--jobs', "$Jobs")
if ($ForceRebuild) {
  $args += '--force-rebuild'
}
if ($Gui) {
  $args += '--gui'
}
else {
  $args += '--headless'
}

& $python.Source @args
