param([int]$Port = 8767, [switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
$repositoryPath = Split-Path -Parent $PSScriptRoot
$configPath = Join-Path $repositoryPath '.photos-local.json'
if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) {
    throw 'Create .photos-local.json first; see blog/摄影相册维护.md.'
}
$photoSettings = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
$pythonExecutable = 'python'
if ($photoSettings.runtime -and $photoSettings.runtime.python) {
    $pythonExecutable = [string]$photoSettings.runtime.python
}
$previousPythonPath = $env:PYTHONPATH
try {
    if ($photoSettings.runtime -and $photoSettings.runtime.pythonpath) {
        $env:PYTHONPATH = [string]$photoSettings.runtime.pythonpath
        if ($previousPythonPath) { $env:PYTHONPATH += [IO.Path]::PathSeparator + $previousPythonPath }
    }
    $photoArguments = @((Join-Path $PSScriptRoot 'update_photos.py'), '--config', $configPath, '--port', "$Port")
    if (-not $BuildOnly) { $photoArguments += '--serve' }
    & $pythonExecutable @photoArguments
    if ($LASTEXITCODE -ne 0) { throw "Photography preview failed with exit code $LASTEXITCODE." }
} finally {
    $env:PYTHONPATH = $previousPythonPath
}
