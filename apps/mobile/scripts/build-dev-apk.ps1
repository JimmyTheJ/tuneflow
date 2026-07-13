# Build a local Android debug APK and record version metadata under %USERPROFILE%\.tuneflow-mobile-dev\
# Modeled after jellyfin-android's DevBuildMetadata workflow.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$mobileRoot = Split-Path -Parent $PSScriptRoot
$repoRoot = Resolve-Path (Join-Path $mobileRoot "..\..")
$metadataScript = Join-Path $PSScriptRoot "read-dev-version.mjs"
$androidDir = Join-Path $mobileRoot "android"
$apkOutputDir = Join-Path $androidDir "app\build\outputs\apk\debug"

function Resolve-SystemSdkManager {
    $sdkRoots = @(
        $env:ANDROID_HOME,
        "C:\Program Files (x86)\Android\android-sdk",
        (Join-Path $env:LOCALAPPDATA "Android\Sdk")
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($sdkRoot in @($sdkRoots)) {
        $sdkmanager = Join-Path $sdkRoot "cmdline-tools\latest\bin\sdkmanager.bat"
        if (Test-Path $sdkmanager) {
            return $sdkmanager
        }
    }

    return $null
}

function Ensure-WritableAndroidSdk {
    $userSdk = Join-Path $env:USERPROFILE ".tuneflow-android-sdk"
    $platformTools = Join-Path $userSdk "platform-tools"
    if (Test-Path $platformTools) {
        return $userSdk
    }

    $sdkmanager = Resolve-SystemSdkManager
    if (-not $sdkmanager) {
        throw "sdkmanager not found. Install Android Studio command-line tools first."
    }

    New-Item -ItemType Directory -Path $userSdk -Force | Out-Null
    Write-Host "Bootstrapping writable Android SDK at $userSdk (first run may take a few minutes)..."

    $yes = ("y`n" * 50)
    $yes | & $sdkmanager --sdk_root=$userSdk --licenses | Out-Null

    & $sdkmanager --sdk_root=$userSdk `
        "platform-tools" `
        "platforms;android-35" `
        "build-tools;35.0.0" `
        "cmake;3.22.1" `
        "ndk;27.1.12297006" | Out-Host

    if (-not (Test-Path $platformTools)) {
        throw "Failed to bootstrap Android SDK at $userSdk"
    }

    return $userSdk
}

function Resolve-AndroidSdk {
    $userSdk = Ensure-WritableAndroidSdk

    $candidates = @(
        $userSdk,
        $env:ANDROID_HOME,
        $env:ANDROID_SDK_ROOT,
        (Join-Path $env:LOCALAPPDATA "Android\Sdk"),
        "C:\Program Files (x86)\Android\android-sdk",
        "C:\Android\Sdk"
    ) | Where-Object { $_ -and (Test-Path $_) }

    if (@($candidates).Length -gt 0) {
        return (@($candidates) | Select-Object -First 1)
    }

    throw @"
Android SDK not found. Install Android Studio or set ANDROID_HOME.

Checked:
  - %USERPROFILE%\.tuneflow-android-sdk
  - %ANDROID_HOME%
  - %ANDROID_SDK_ROOT%
  - %LOCALAPPDATA%\Android\Sdk
  - C:\Program Files (x86)\Android\android-sdk
"@
}

function Resolve-AndroidNdk {
    $userSdkNdk = Join-Path $env:USERPROFILE ".tuneflow-android-sdk\ndk\27.1.12297006"
    $candidates = @(
        $env:ANDROID_NDK_HOME,
        $userSdkNdk,
        "C:\Program Files (x86)\Android\AndroidNDK\android-ndk-r27c",
        "C:\Program Files (x86)\Android\AndroidNDK\android-ndk-r23c"
    ) | Where-Object { $_ -and (Test-Path $_) }

    if (@($candidates).Length -gt 0) {
        return (@($candidates) | Select-Object -First 1)
    }

    return $null
}

function Accept-AndroidSdkLicenses {
    param([string]$SdkPath)

    $sdkmanager = Join-Path $SdkPath "cmdline-tools\latest\bin\sdkmanager.bat"
    if (-not (Test-Path $sdkmanager)) {
        Write-Warning "sdkmanager not found at $sdkmanager; skipping license acceptance"
        return
    }

    Write-Host "Accepting Android SDK licenses..."
    $yes = ("y`n" * 50)
    $yes | & $sdkmanager --sdk_root=$SdkPath --licenses | Out-Host
}

function Write-LocalProperties {
    param(
        [string]$SdkPath,
        [string]$NdkPath
    )

    $localProperties = Join-Path $androidDir "local.properties"
    $escapedSdkPath = $SdkPath -replace "\\", "\\\\"
    $lines = @("sdk.dir=$escapedSdkPath")
    if ($NdkPath) {
        $escapedNdkPath = $NdkPath -replace "\\", "\\\\"
        $lines += "ndk.dir=$escapedNdkPath"
    }
    $lines | Set-Content -Path $localProperties -Encoding ASCII
}

function Get-NdkRevision {
    param([string]$NdkPath)

    $sourceProps = Join-Path $NdkPath "source.properties"
    if (-not (Test-Path $sourceProps)) {
        return $null
    }

    foreach ($line in Get-Content $sourceProps) {
        if ($line -match '^Pkg\.Revision\s*=\s*(.+)$') {
            return $Matches[1].Trim()
        }
    }

    return $null
}

function Patch-DevGradleProperties {
    $gradleProperties = Join-Path $androidDir "gradle.properties"
    if (-not (Test-Path $gradleProperties)) {
        return
    }

    $content = Get-Content $gradleProperties -Raw
    $patched = $content -replace 'newArchEnabled=true', 'newArchEnabled=false'
    if ($content -ne $patched) {
        Set-Content -Path $gradleProperties -Value $patched -NoNewline
        Write-Host "Disabled New Architecture for local dev APK builds"
    }
}

function Patch-AndroidNdkVersion {
    param(
        [string]$NdkPath
    )

    $ndkRevision = Get-NdkRevision -NdkPath $NdkPath
    if (-not $ndkRevision) {
        Write-Warning "Could not read NDK revision from $NdkPath"
        return
    }

    $rootGradle = Join-Path $androidDir "build.gradle"
    if (-not (Test-Path $rootGradle)) {
        throw "Expected Gradle file at $rootGradle"
    }

    $rootContent = Get-Content $rootGradle -Raw
    if ($rootContent -notmatch 'tuneflowDevNdkVersion') {
        $injection = @"

// tuneflowDevNdkVersion: pin installed NDK for local dev builds
ext.ndkVersion = "$ndkRevision"

"@
        $rootPatched = $rootContent -replace 'apply plugin: "expo-root-project"', "$injection`$0"
        if ($rootContent -eq $rootPatched) {
            Write-Warning "Could not patch root ndkVersion in $rootGradle"
        } else {
            Set-Content -Path $rootGradle -Value $rootPatched -NoNewline
            Write-Host "Pinned root Android NDK version to $ndkRevision"
        }
    }

    $appGradle = Join-Path $androidDir "app\build.gradle"
    if (-not (Test-Path $appGradle)) {
        throw "Expected Gradle file at $appGradle"
    }

    $content = Get-Content $appGradle -Raw
    $patched = $content -replace 'ndkVersion rootProject\.ext\.ndkVersion', "ndkVersion `"$ndkRevision`""
    if ($content -eq $patched) {
        Write-Warning "Could not patch app ndkVersion in $appGradle"
        return
    }

    Set-Content -Path $appGradle -Value $patched -NoNewline
    Write-Host "Pinned app Android NDK version to $ndkRevision"
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
    $sdkPath = Resolve-AndroidSdk
    $ndkPath = Resolve-AndroidNdk
    $env:ANDROID_HOME = $sdkPath
    $env:ANDROID_SDK_ROOT = $sdkPath
    if ($ndkPath) {
        $env:ANDROID_NDK_HOME = $ndkPath
    }
    Write-Host "Using Android SDK: $sdkPath"
    if ($ndkPath) {
        Write-Host "Using Android NDK: $ndkPath"
    }

    Accept-AndroidSdkLicenses -SdkPath $sdkPath

    npx expo prebuild --platform android --clean

    Write-LocalProperties -SdkPath $sdkPath -NdkPath $ndkPath
    Patch-DevGradleProperties
    if ($ndkPath -and ($ndkPath -notmatch '27\.1\.12297006')) {
        Patch-AndroidNdkVersion -NdkPath $ndkPath
    }

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
        throw @"
No debug APK found in $apkOutputDir

Gradle may have failed earlier in this run. Re-run with the android folder present and check:
  cd apps\mobile\android
  .\gradlew.bat assembleDebug --stacktrace
"@
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
