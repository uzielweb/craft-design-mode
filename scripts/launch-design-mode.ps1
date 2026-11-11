param(
    [ValidateSet("both", "effectcraft", "filmcraft")]
    [string]$Target = "both",
    [switch]$OpenBrowser
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot

# Ephemeral 64-hex session token for FilmCraft Control Protocol (never persisted in repo files)
if (-not $env:FILMCRAFT_CONTROL_TOKEN) {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $env:FILMCRAFT_CONTROL_TOKEN = ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Start-InteractiveApp {
    param(
        [string]$TaskName,
        [string]$ExePath,
        [int]$ControlPort,
        [string]$CommandOverride = ""
    )
    if (-not (Test-Path $ExePath)) {
        Write-Warning "Executável não encontrado: $ExePath"
        return
    }
    $tr = if ($CommandOverride) { $CommandOverride } else { '\"' + $ExePath + '\" --control ' + $ControlPort }
    Write-Host "Iniciando $TaskName na Sessão 1 (controle TCP :$ControlPort)..." -ForegroundColor Cyan
    schtasks /create /tn $TaskName /tr $tr /sc once /st 23:59 /it /f | Out-Null
    schtasks /run /tn $TaskName | Out-Null
    Start-Sleep -Seconds 2
    schtasks /delete /tn $TaskName /f | Out-Null
}

if ($Target -eq "both" -or $Target -eq "effectcraft") {
    if (-not (Get-Process effectcraft -ErrorAction SilentlyContinue)) {
        Start-InteractiveApp -TaskName "RunEffectCraftDesignMode" -ExePath "C:\Program Files\EffectCraft\effectcraft.exe" -ControlPort 7983
    } else {
        Write-Host "EffectCraft já está em execução." -ForegroundColor Gray
    }
}

if ($Target -eq "both" -or $Target -eq "filmcraft") {
    if (-not (Get-Process filmcraft -ErrorAction SilentlyContinue)) {
        $fcCmd = "cmd.exe /c `"set FILMCRAFT_CONTROL_TOKEN=$($env:FILMCRAFT_CONTROL_TOKEN) && `"C:\Program Files\FilmCraft\filmcraft.exe`" --control 7982`""
        $fcTr = $fcCmd.Replace('"', '\"')
        Start-InteractiveApp -TaskName "RunFilmCraftDesignMode" -ExePath "C:\Program Files\FilmCraft\filmcraft.exe" -ControlPort 7982 -CommandOverride $fcTr
    } else {
        Write-Host "FilmCraft já está em execução." -ForegroundColor Gray
    }
}

if ($OpenBrowser) {
    Start-Process "http://127.0.0.1:4173"
}

Push-Location $RepoRoot
try {
    node packages/bridge-server/src/server.mjs
} finally {
    Pop-Location
}
