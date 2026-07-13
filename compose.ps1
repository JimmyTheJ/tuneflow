#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Import-EnvVarFromDotEnv {
    param(
        [string]$Key
    )

    if ((Get-Item -Path "env:$Key" -ErrorAction SilentlyContinue)?.Value) {
        return
    }

    if (-not (Test-Path .env)) {
        return
    }

    $line = Get-Content .env |
        Where-Object { $_ -match "^\s*$([regex]::Escape($Key))\s*=" } |
        Select-Object -Last 1

    if (-not $line) {
        return
    }

    $value = ($line -split '=', 2)[1].Trim().Trim('"').Trim("'")
    if ($value) {
        Set-Item -Path "env:$Key" -Value $value
    }
}

# compose.ps1 must read .env itself: Docker Compose loads .env for interpolation,
# but the shell needs DOCKER_SHARED_NETWORK to decide whether to include the overlay.
Import-EnvVarFromDotEnv -Key DOCKER_SHARED_NETWORK

$composeArgs = @("-f", "docker-compose.yml")

if ($env:DOCKER_SHARED_NETWORK) {
    $composeArgs += @("-f", "docker-compose.shared-network.yml")
}

& docker compose @composeArgs @args
exit $LASTEXITCODE
