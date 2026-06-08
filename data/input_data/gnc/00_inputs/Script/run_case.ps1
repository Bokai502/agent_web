param(
  [string]$CaseRoot = '',
  [switch]$Gui,
  [switch]$ReuseRuntime
)

$ErrorActionPreference = 'Stop'
$script = Join-Path $PSScriptRoot 'run_case.py'
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
  $python = Get-Command python3 -ErrorAction SilentlyContinue
}
if (-not $python) {
  throw 'Python is required to run run_case.py'
}

$args = @($script)
if (-not [string]::IsNullOrWhiteSpace($CaseRoot)) {
  $args += @('--case-root', $CaseRoot)
}
if ($Gui) {
  $args += '--gui'
}
else {
  $args += '--headless'
}
if ($ReuseRuntime) {
  $args += '--reuse-runtime'
}

& $python.Source @args
