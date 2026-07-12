#!/usr/bin/env pwsh
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$composeArgs = @("-f", "docker-compose.yml")

if ($env:DOCKER_SHARED_NETWORK) {
    $composeArgs += @("-f", "docker-compose.shared-network.yml")
}

& docker compose @composeArgs @args
exit $LASTEXITCODE
