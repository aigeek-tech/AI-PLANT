$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$backendDir = Join-Path $repoRoot 'backend'
$frontendDir = Join-Path $repoRoot 'frontend'

Write-Host '[1/3] backend ai settings tests'
Push-Location $backendDir
try {
    python -m pytest tests/test_ai_settings_api.py
    if ($LASTEXITCODE -ne 0) {
        throw "backend ai settings tests failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host '[2/3] frontend lint'
Push-Location $frontendDir
try {
    npm run lint
    if ($LASTEXITCODE -ne 0) {
        throw "frontend lint failed with exit code $LASTEXITCODE"
    }
    Write-Host '[3/3] frontend build'
    npm run build
    if ($LASTEXITCODE -ne 0) {
        throw "frontend build failed with exit code $LASTEXITCODE"
    }
}
finally {
    Pop-Location
}

Write-Host 'ai-settings verification passed'
