$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$JsxPath = Join-Path $RepoRoot "integrations\effectcraft\Design Mode.jsx"
$EffectCraftPanelsDir = Join-Path $env:APPDATA "EffectCraft\Scripts\ScriptUI Panels"
$EffectCraftCli = "C:\Program Files\EffectCraft\effectcraft-cli.exe"
$FilmCraftCli = "C:\Program Files\FilmCraft\filmcraft-cli.exe"

Write-Host "=== Instalando Design Mode no EffectCraft & FilmCraft ===" -ForegroundColor Cyan

# 1. Build studio dist so bridge-server serves ready UI
Push-Location $RepoRoot
try {
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build falhou" }
} finally {
    Pop-Location
}

# 2. Install native dockable ScriptUI Panel into EffectCraft
if (Test-Path $JsxPath) {
    New-Item -ItemType Directory -Force -Path $EffectCraftPanelsDir | Out-Null
    $destJsx = Join-Path $EffectCraftPanelsDir "Design Mode.jsx"
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    $jsxContent = [System.IO.File]::ReadAllText($JsxPath, [System.Text.Encoding]::UTF8)
    [System.IO.File]::WriteAllText($destJsx, $jsxContent, $utf8NoBom)
    Write-Host "[EffectCraft] ScriptUI Panel instalado em: $destJsx" -ForegroundColor Green

    if (Test-Path $EffectCraftCli) {
        try {
            & $EffectCraftCli --bridge 7983 exec file.scripts.list 2>$null
        } catch {
            # EffectCraft não está aberto com --control 7983 no momento; o painel será carregado na próxima inicialização.
        }
    }
}

# 3. Verify FilmCraft CLI & Live Control protocol availability
if (Test-Path $FilmCraftCli) {
    Write-Host "[FilmCraft] CLI detectado: $FilmCraftCli" -ForegroundColor Green
    Write-Host "[FilmCraft] Integração configurada via Live Control Channel (TCP 127.0.0.1:7982) + Bridge Server (http://127.0.0.1:4173)." -ForegroundColor Cyan
} else {
    Write-Warning "FilmCraft CLI não encontrado em $FilmCraftCli"
}

Write-Host ""
Write-Host "Instalação concluída!" -ForegroundColor Green
Write-Host "Para iniciar EffectCraft + FilmCraft com o Live Bridge e o Studio:" -ForegroundColor White
Write-Host "  powershell -ExecutionPolicy Bypass -File `"$RepoRoot\scripts\launch-design-mode.ps1`"" -ForegroundColor Gray
