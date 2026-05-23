param(
  [string]$ConfigPath = (Join-Path $PSScriptRoot "deploy.local.json"),
  [string]$Tag = "",
  [switch]$SkipTests,
  [switch]$SkipFrontendLint,
  [switch]$SkipMigration,
  [switch]$NoPushLatest
)

$ErrorActionPreference = "Stop"

function Run-Step {
  param(
    [string]$Title,
    [scriptblock]$Script
  )

  Write-Host ""
  Write-Host "==> $Title" -ForegroundColor Cyan
  & $Script
}

function Require-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Invoke-Remote {
  param([string]$Command)
  & $PlinkPath -ssh -P $Config.sshPort -l $Config.sshUser -pw $Config.sshPassword -batch $Config.host $Command
  if ($LASTEXITCODE -ne 0) {
    throw "Remote command failed: $Command"
  }
}

function Copy-ToRemote {
  param(
    [string[]]$Source,
    [string]$Target
  )
  & $PscpPath -P $Config.sshPort -pw $Config.sshPassword @Source "$($Config.sshUser)@$($Config.host):$Target"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote copy failed: $($Source -join ', ') -> $Target"
  }
}

function Copy-DirectoryToRemote {
  param(
    [string]$Source,
    [string]$Target
  )
  & $PscpPath -r -P $Config.sshPort -pw $Config.sshPassword $Source "$($Config.sshUser)@$($Config.host):$Target"
  if ($LASTEXITCODE -ne 0) {
    throw "Remote directory copy failed: $Source -> $Target"
  }
}

function Invoke-RemoteWithRetry {
  param(
    [string]$Command,
    [int]$Attempts = 12,
    [int]$DelaySeconds = 5
  )

  for ($attempt = 1; $attempt -le $Attempts; $attempt++) {
    & $PlinkPath -ssh -P $Config.sshPort -l $Config.sshUser -pw $Config.sshPassword -batch $Config.host $Command
    if ($LASTEXITCODE -eq 0) {
      return
    }
    if ($attempt -eq $Attempts) {
      throw "Remote command failed after $Attempts attempts: $Command"
    }
    Write-Host "Remote check failed, retrying in $DelaySeconds seconds ($attempt/$Attempts)..." -ForegroundColor Yellow
    Start-Sleep -Seconds $DelaySeconds
  }
}

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
Set-Location $RepoRoot

if (-not (Test-Path $ConfigPath)) {
  $examplePath = Join-Path $PSScriptRoot "deploy.local.example.json"
  throw "Missing local deployment config: $ConfigPath. Copy $examplePath to deploy.local.json and fill sshPassword."
}

$Config = Get-Content $ConfigPath -Raw | ConvertFrom-Json
if (-not $Config.sshPassword) {
  throw "deploy.local.json must set sshPassword."
}

Require-Command docker
Require-Command git
Require-Command python
Require-Command pnpm

$PlinkPath = (Get-Command plink -ErrorAction SilentlyContinue).Source
$PscpPath = (Get-Command pscp -ErrorAction SilentlyContinue).Source
if (-not $PlinkPath -or -not $PscpPath) {
  throw "PuTTY plink/pscp are required. Install PuTTY or add them to PATH."
}

if (-not $Tag) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $shortSha = (git rev-parse --short HEAD).Trim()
  $Tag = "$stamp-$shortSha"
}

$registryNamespace = $Config.registryNamespace.TrimEnd("/")
$backendImage = "$registryNamespace/smart-design-backend:$Tag"
$frontendImage = "$registryNamespace/smart-design-frontend:$Tag"
$converterImage = "$registryNamespace/smart-design-document-converter:$Tag"

Write-Host "Publishing tag: $Tag" -ForegroundColor Green

if (-not $SkipTests) {
  Run-Step "Run backend focused tests" {
    python -m pytest `
      backend\tests\test_document_api.py `
      backend\tests\test_document_conversion_service.py `
      backend\tests\test_document_service.py `
      backend\tests\test_document_storage.py `
      backend\tests\test_settings_repository.py `
      backend\tests\test_ai_settings_api.py `
      -q
  }
}

if (-not $SkipFrontendLint) {
  Run-Step "Run frontend lint" {
    pnpm --dir frontend lint
  }
}

Run-Step "Run frontend production build" {
  pnpm --dir frontend build
}

Run-Step "Update Aliyun compose image tags" {
  $composePath = Join-Path $PSScriptRoot "docker-compose.aliyun.yml"
  $compose = Get-Content $composePath -Raw
  $compose = [regex]::Replace(
    $compose,
    [regex]::Escape("$registryNamespace/smart-design-backend:") + "\S+",
    $backendImage
  )
  $compose = [regex]::Replace(
    $compose,
    [regex]::Escape("$registryNamespace/smart-design-frontend:") + "\S+",
    $frontendImage
  )
  $compose = [regex]::Replace(
    $compose,
    [regex]::Escape("$registryNamespace/smart-design-document-converter:") + "\S+",
    $converterImage
  )
  Set-Content -Path $composePath -Value $compose -NoNewline
}

Run-Step "Build Docker images" {
  docker build -t smart-design-backend:local .\backend
  docker build -t smart-design-frontend:local .\frontend
  docker build -f .\backend\Dockerfile.document-converter -t smart-design-document-converter:local .
}

Run-Step "Push Docker images" {
  $images = @(
    @{ Local = "smart-design-backend:local"; Remote = $backendImage; Latest = "$registryNamespace/smart-design-backend:latest" },
    @{ Local = "smart-design-frontend:local"; Remote = $frontendImage; Latest = "$registryNamespace/smart-design-frontend:latest" },
    @{ Local = "smart-design-document-converter:local"; Remote = $converterImage; Latest = "$registryNamespace/smart-design-document-converter:latest" }
  )
  foreach ($image in $images) {
    docker tag $image.Local $image.Remote
    docker push $image.Remote
    if (-not $NoPushLatest) {
      docker tag $image.Local $image.Latest
      docker push $image.Latest
    }
  }
}

Run-Step "Sync deployment files to remote" {
  Invoke-Remote "mkdir -p '$($Config.remoteDir)/config' '$($Config.remoteDir)/mounts/postgres/initdb' '$($Config.remoteDir)/sample-data/minio'"

  Copy-ToRemote -Source @(
    (Join-Path $PSScriptRoot "docker-compose.aliyun.yml"),
    (Join-Path $PSScriptRoot "docker-compose.offline.yml"),
    (Join-Path $PSScriptRoot "start-aliyun.sh"),
    (Join-Path $PSScriptRoot "start.sh"),
    (Join-Path $PSScriptRoot ".env.example")
  ) -Target "$($Config.remoteDir)/"

  Copy-ToRemote -Source @(
    (Join-Path $PSScriptRoot "config\backend.env.example"),
    (Join-Path $PSScriptRoot "config\frontend-nginx.conf")
  ) -Target "$($Config.remoteDir)/config/"

  $initdbSqlFiles = Get-ChildItem -Path (Join-Path $PSScriptRoot "mounts\postgres\initdb\*.sql") -File |
    ForEach-Object { $_.FullName }
  if (-not $initdbSqlFiles) {
    throw "No PostgreSQL initdb SQL files found under deploy/offline/mounts/postgres/initdb."
  }
  Copy-ToRemote -Source $initdbSqlFiles -Target "$($Config.remoteDir)/mounts/postgres/initdb/"

  $sampleMinioDir = Resolve-Path (Join-Path $PSScriptRoot "..\..\sample-data\minio\smart-design-documents")
  Copy-DirectoryToRemote -Source $sampleMinioDir.Path -Target "$($Config.remoteDir)/sample-data/minio/"
}

if (-not $SkipMigration) {
  Run-Step "Apply pending PostgreSQL initdb SQL files by table existence" {
    $remote = @'
set -eu
cd "$REMOTE_DIR"
for file in mounts/postgres/initdb/*.sql; do
  base=$(basename "$file")
  case "$base" in
    0010_spark_visualization_assets.sql)
      exists=$(docker exec smart-design-postgres psql -U postgres -d smart_design -tAc "select to_regclass('public.document_visualization_asset')" | tr -d '[:space:]')
      if [ "$exists" = "document_visualization_asset" ]; then
        echo "skip $base"
      else
        echo "apply $base"
        docker exec -i smart-design-postgres psql -U postgres -d smart_design < "$file"
      fi
      ;;
    0016_strict_equipment_attribute_values.sql)
      exists=$(docker exec smart-design-postgres psql -U postgres -d smart_design -tAc "select to_regclass('public.equipment')" | tr -d '[:space:]')
      if [ "$exists" = "equipment" ]; then
        echo "apply $base"
        docker exec -i smart-design-postgres psql -U postgres -d smart_design < "$file"
      else
        echo "skip $base (equipment table missing)"
      fi
      ;;
    0019_visualization_semantic_objects.sql)
      exists=$(docker exec smart-design-postgres psql -U postgres -d smart_design -tAc "select to_regclass('public.document_visualization_object')" | tr -d '[:space:]')
      if [ "$exists" = "document_visualization_object" ]; then
        echo "skip $base"
      else
        echo "apply $base"
        docker exec -i smart-design-postgres psql -U postgres -d smart_design < "$file"
      fi
      ;;
    0023_local_dev_sample_data.sql)
      exists=$(docker exec smart-design-postgres psql -U postgres -d smart_design -tAc "select exists(select 1 from public.document where id = '13a361fc-82bc-4d4a-9731-8472d82dfbe5')" | tr -d '[:space:]')
      if [ "$exists" = "t" ]; then
        echo "skip $base"
      else
        echo "apply $base"
        docker exec -i smart-design-postgres psql -U postgres -d smart_design < "$file"
      fi
      ;;
    *)
      echo "skip $base (initdb-only baseline)"
      ;;
  esac
done
'@
    $remote = $remote.Replace('$REMOTE_DIR', $Config.remoteDir)
    $remote = $remote.Replace("`r`n", "`n").Replace("`r", "`n")
    Invoke-Remote "cat > /tmp/smart-design-apply-migrations.sh <<'SH'$([char]10)$remote$([char]10)SH$([char]10)sh /tmp/smart-design-apply-migrations.sh"
  }
}

Run-Step "Pull and restart remote services" {
  Invoke-Remote "cd '$($Config.remoteDir)' && chmod +x start-aliyun.sh start.sh && ./start-aliyun.sh"
}

Run-Step "Verify remote services" {
  Invoke-Remote "cd '$($Config.remoteDir)' && docker compose --env-file .env -f docker-compose.offline.yml -f docker-compose.aliyun.yml ps"
  Invoke-RemoteWithRetry "curl -fsS http://127.0.0.1:3001/health && curl -fsS http://127.0.0.1:5173/api/auth/bootstrap/status"
  if ($Config.publicHealthUrl) {
    curl.exe -fsS $Config.publicHealthUrl
  }
}

Write-Host ""
Write-Host "Published $Tag successfully." -ForegroundColor Green
