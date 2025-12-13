$ProgressPreference = 'SilentlyContinue'
$url = "https://unpkg.com/three@0.152.2/build/three.min.js"
$output = "c:\Users\luisn\Desktop\RED\three.min.js"

if (-not (Test-Path $output)) {
    Write-Host "Downloading Three.js..."
    Invoke-WebRequest -Uri $url -OutFile $output -TimeoutSec 60
    Write-Host "Three.js downloaded to $output"
} else {
    Write-Host "Three.js already exists at $output"
}
