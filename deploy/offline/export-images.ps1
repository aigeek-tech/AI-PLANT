$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$imagesDir = Join-Path $scriptDir "images"
New-Item -ItemType Directory -Force -Path $imagesDir | Out-Null

$output = Join-Path $imagesDir "smart-design-offline-images.tar"
$images = @(
  "postgres:16",
  "minio/minio:RELEASE.2025-02-18T16-25-55Z",
  "minio/mc:RELEASE.2025-02-21T16-00-46Z",
  "ymlisoft/kkfileview:4.4.0-12",
  "smart-design-backend:local",
  "smart-design-document-converter:local",
  "smart-design-frontend:local"
)

docker save -o $output @images
Write-Host "Wrote $output"

