$ErrorActionPreference = 'Stop'
$repositoryPath = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$pidPath = Join-Path $repositoryPath '.local-checks\map-preview.pid'
if (-not (Test-Path -LiteralPath $pidPath -PathType Leaf)) { Write-Host 'No recorded background map preview.'; exit 0 }
$mapPreviewProcessId = 0
if (-not [int]::TryParse((Get-Content -LiteralPath $pidPath -Raw).Trim(), [ref]$mapPreviewProcessId)) { throw 'Invalid recorded preview process id.' }
$mapPreviewProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $mapPreviewProcessId"
if (-not $mapPreviewProcess) { Write-Host 'The recorded map preview has already stopped.'; exit 0 }
if ($mapPreviewProcess.Name -notmatch '^python(?:w)?\.exe$' -or $mapPreviewProcess.CommandLine -notmatch 'scripts[\\/]preview_site\.py\s+--map-draft\s+--port\s+8768(?:\s|$)') {
    throw 'The recorded process does not match this map preview; keep it running.'
}
Stop-Process -Id $mapPreviewProcessId
Write-Host 'Local background map preview stopped.'
