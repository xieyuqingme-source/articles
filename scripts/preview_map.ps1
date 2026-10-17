param([int]$Port = 8768, [switch]$BuildOnly)
$ErrorActionPreference = 'Stop'
$repositoryPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Push-Location -LiteralPath $repositoryPath
$previousPythonPath = $env:PYTHONPATH
try {
    $configPath = Join-Path $repositoryPath '.map-local.json'
    $mapSettings = Get-Content -LiteralPath $configPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $pythonExecutable = 'python'
    if ($mapSettings.runtime -and $mapSettings.runtime.python) { $pythonExecutable = [string]$mapSettings.runtime.python }
    if ($mapSettings.runtime -and $mapSettings.runtime.pythonpath) {
        $env:PYTHONPATH = [string]$mapSettings.runtime.pythonpath
        if ($previousPythonPath) { $env:PYTHONPATH += [IO.Path]::PathSeparator + $previousPythonPath }
    }
    & $pythonExecutable scripts/update_map.py --preview
    if ($LASTEXITCODE -ne 0) { throw 'Map preview build failed.' }
    Write-Host "Local map preview: http://127.0.0.1:$Port/map/"
    if (-not $BuildOnly) {
        & $pythonExecutable scripts/preview_site.py --map-draft --port $Port
        if ($LASTEXITCODE -ne 0) { throw 'Map preview server failed.' }
    }
} finally { $env:PYTHONPATH = $previousPythonPath; Pop-Location }
