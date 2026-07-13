# Build a local Android debug APK and record version metadata under %USERPROFILE%\.tuneflow-mobile-dev\
# Modeled after jellyfin-android's DevBuildMetadata workflow.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$mobileRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $mobileRoot "..\..")
$metadataScript = Join-Path $PSScriptRoot "read-dev-version.mjs"
$androidDir = Join-Path $mobileRoot "android"
$apkOutputDir = Join-Path $androidDir "app\build\outputs\apk\debug"

function Resolve-AndroidSdk {
    if ($env:ANDROID_HOME -and (Test-Path $env:ANDROID_HOME)) {
        return $env:ANDROID_HOME
    }
    if ($env:ANDROID_SDK_ROOT -and (Test-Path $env:ANDROID_SDK_ROOT)) {
        return $env:ANDROID_SDK_ROOT
    }
    $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    if (Test-Path $defaultSdk) {
        return $defaultSdk
    }
    throw "Android SDK not found. Install Android Studio or set ANDROID_HOME."
}

Push-Location $mobileRoot
try {
    if (-not (Test-Path (Join-Path $mobileRoot "node_modules"))) {
        Write-Host "Installing npm dependencies..."
        npm install
    }

    $versionInfo = node $metadataScript | ConvertFrom-Json
    $versionName = $versionInfo.versionName
    $versionCode = [int]$versionInfo.versionCode

    Write-Host "Building Tuneflow dev APK $versionName (versionCode $versionCode)..."

    $env:TUNEFLOW_DEV_BUILD = "1"
    $env:ANDROID_HOME = Resolve-AndroidSdk
    $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

    npx expo prebuild --platform android --clean

    $gradlew = Join-Path $androidDir "gradlew.bat"
    if (-not (Test-Path $gradlew)) {
        throw "Gradle wrapper not found at $gradlew"
    }

    Push-Location $androidDir
    try {
        & $gradlew assembleDebug
    }
    finally {
        Pop-Location
    }

    $apkFiles = Get-ChildItem -Path $apkOutputDir -Filter "*.apk" -File -ErrorAction SilentlyContinue
    if (-not $apkFiles) {
        throw "No debug APK found in $apkOutputDir"
    }

    $sourceApk = $apkFiles | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    $targetName = "tuneflow-v$versionName-debug.apk"
    $targetApk = Join-Path $apkOutputDir $targetName
    Copy-Item -Path $sourceApk.FullName -Destination $targetApk -Force

    $recordScript = Join-Path $PSScriptRoot "record-dev-build.mjs"
    node $recordScript --apk $targetApk --version $versionName --code $versionCode

    Write-Host ""
    Write-Host "Dev APK ready:"
    Write-Host "  $targetApk"
    Write-Host "Metadata:"
    Write-Host "  $(Join-Path $env:USERPROFILE '.tuneflow-mobile-dev\last-build.properties')"
}
finally {
    Pop-Location
}
