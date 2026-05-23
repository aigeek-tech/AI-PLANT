param(
    [switch]$ForceInstall
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue) {
    $PSNativeCommandUseErrorActionPreference = $false
}

function Get-EnvOrDefault {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [AllowEmptyString()]
        [string]$DefaultValue
    )

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }
    return $value.Trim()
}

function Get-EnvIntOrDefault {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [int]$DefaultValue
    )

    $value = [Environment]::GetEnvironmentVariable($Name)
    if ([string]::IsNullOrWhiteSpace($value)) {
        return $DefaultValue
    }
    return [int]$value.Trim()
}

$RepoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BackendDir = Join-Path $RepoRoot 'backend'
$FrontendDir = Join-Path $RepoRoot 'frontend'
$BackendVenvDir = Join-Path $BackendDir '.venv'
$BackendPython = Join-Path $BackendVenvDir 'Scripts\python.exe'
$BackendRequirements = Join-Path $BackendDir 'requirements.txt'
$FrontendLockfile = Join-Path $FrontendDir 'pnpm-lock.yaml'
$SmartDesignEnv = Get-EnvOrDefault -Name 'SMART_DESIGN_ENV' -DefaultValue 'development'
$PostgresDb = Get-EnvOrDefault -Name 'POSTGRES_DB' -DefaultValue 'smart_design'
$PostgresUser = Get-EnvOrDefault -Name 'POSTGRES_USER' -DefaultValue 'postgres'
$PostgresPassword = Get-EnvOrDefault -Name 'POSTGRES_PASSWORD' -DefaultValue 'postgres'
$PostgresHostPort = Get-EnvIntOrDefault -Name 'POSTGRES_HOST_PORT' -DefaultValue 55432
$DatabaseUrl = Get-EnvOrDefault -Name 'DATABASE_URL' -DefaultValue "postgresql://${PostgresUser}:${PostgresPassword}@localhost:${PostgresHostPort}/${PostgresDb}"
$BackendPort = Get-EnvIntOrDefault -Name 'SMART_DESIGN_BACKEND_PORT' -DefaultValue 3001
$FrontendPort = Get-EnvIntOrDefault -Name 'SMART_DESIGN_FRONTEND_PORT' -DefaultValue 5173
$PostgresContainerName = 'smart-design-postgres'
$MinioContainerName = 'smart-design-minio'
$KkFileViewContainerName = 'smart-design-kkfileview'
$MinioPort = Get-EnvIntOrDefault -Name 'MINIO_API_PORT' -DefaultValue 9000
$MinioConsolePort = Get-EnvIntOrDefault -Name 'MINIO_CONSOLE_PORT' -DefaultValue 9001
$KkFileViewPort = 8012
$ConfiguredS3Endpoint = if ($env:S3_ENDPOINT) { $env:S3_ENDPOINT.Trim() } elseif ($env:MINIO_ENDPOINT) { $env:MINIO_ENDPOINT.Trim() } else { '' }
$ExplicitS3Endpoint = $ConfiguredS3Endpoint -ne ''
$MinioBucket = if ($env:S3_BUCKET) { $env:S3_BUCKET.Trim() } elseif ($env:MINIO_BUCKET_NAME) { $env:MINIO_BUCKET_NAME.Trim() } else { Get-EnvOrDefault -Name 'S3_BUCKET' -DefaultValue 'smart-design-documents' }
$MinioEndpoint = if ($ExplicitS3Endpoint -and ($ConfiguredS3Endpoint -match '^https?://')) { $ConfiguredS3Endpoint } elseif ($ExplicitS3Endpoint) { "http://$ConfiguredS3Endpoint" } else { "http://127.0.0.1:$MinioPort" }
$MinioAccessKey = if ($env:S3_ACCESS_KEY) { $env:S3_ACCESS_KEY.Trim() } elseif ($env:MINIO_ACCESS_KEY) { $env:MINIO_ACCESS_KEY.Trim() } elseif ($env:MINIO_ROOT_USER) { $env:MINIO_ROOT_USER.Trim() } else { 'minioadmin' }
$MinioSecretKey = if ($env:S3_SECRET_KEY) { $env:S3_SECRET_KEY.Trim() } elseif ($env:MINIO_SECRET_KEY) { $env:MINIO_SECRET_KEY.Trim() } elseif ($env:MINIO_ROOT_PASSWORD) { $env:MINIO_ROOT_PASSWORD.Trim() } else { 'minioadmin' }
$KkFileViewEnabled = if ($env:KKFILEVIEW_ENABLED) { $env:KKFILEVIEW_ENABLED.Trim() } else { 'true' }
$KkFileViewBaseUrl = if ($env:KKFILEVIEW_BASE_URL) { $env:KKFILEVIEW_BASE_URL.Trim().TrimEnd('/') } else { "http://127.0.0.1:$KkFileViewPort" }
$KkFileViewKey = if ($env:KKFILEVIEW_KEY) { $env:KKFILEVIEW_KEY.Trim() } else { '' }
$S3PreviewEndpoint = if ($env:S3_PREVIEW_ENDPOINT) { $env:S3_PREVIEW_ENDPOINT.Trim() } elseif (-not $ExplicitS3Endpoint) { 'http://host.docker.internal:9000' } else { '' }
$BootstrapAdminUsername = Get-EnvOrDefault -Name 'SMART_DESIGN_BOOTSTRAP_ADMIN_USERNAME' -DefaultValue 'admin'
$BootstrapAdminPassword = Get-EnvOrDefault -Name 'SMART_DESIGN_BOOTSTRAP_ADMIN_PASSWORD' -DefaultValue 'AIGeek@2025'
$BootstrapAdminDisplayName = Get-EnvOrDefault -Name 'SMART_DESIGN_BOOTSTRAP_ADMIN_DISPLAY_NAME' -DefaultValue 'System Admin'
$BootstrapAdminEmail = Get-EnvOrDefault -Name 'SMART_DESIGN_BOOTSTRAP_ADMIN_EMAIL' -DefaultValue 'admin@example.local'

function Write-Step {
    param([string]$Message)

    Write-Host "[smart_design] $Message" -ForegroundColor Cyan
}

function Find-CommandPath {
    param(
        [Parameter(Mandatory = $true)]
        [string[]]$Candidates
    )

    foreach ($candidate in $Candidates) {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($null -ne $command) {
            return $command.Source
        }
    }

    return $null
}

function Assert-PathExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$Message
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        throw $Message
    }
}

function Test-TcpPortOpen {
    param(
        [Parameter(Mandatory = $true)]
        [int]$Port,
        [string]$HostName = '127.0.0.1',
        [int]$TimeoutMilliseconds = 800
    )

    $client = [System.Net.Sockets.TcpClient]::new()

    try {
        $asyncResult = $client.BeginConnect($HostName, $Port, $null, $null)
        $connected = $asyncResult.AsyncWaitHandle.WaitOne($TimeoutMilliseconds, $false)
        if (-not $connected) {
            return $false
        }

        $client.EndConnect($asyncResult) | Out-Null
        return $true
    } catch {
        return $false
    } finally {
        $client.Dispose()
    }
}

function Wait-Until {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Condition,
        [Parameter(Mandatory = $true)]
        [string]$TimeoutMessage,
        [int]$TimeoutSeconds = 90,
        [int]$PollSeconds = 2
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (& $Condition) {
            return
        }

        Start-Sleep -Seconds $PollSeconds
    }

    throw $TimeoutMessage
}

function Wait-ForHttpOk {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,
        [Parameter(Mandatory = $true)]
        [string]$Url,
        [int]$TimeoutSeconds = 90
    )

    Wait-Until -TimeoutSeconds $TimeoutSeconds -TimeoutMessage "$Name did not become reachable in time: $Url" -Condition {
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
            return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
        } catch {
            return $false
        }
    }
}

function Get-SingleQuotedValue {
    param([Parameter(Mandatory = $true)][AllowEmptyString()][string]$Value)

    return $Value.Replace("'", "''")
}

function Start-DetachedPowerShell {
    param(
        [Parameter(Mandatory = $true)]
        [string]$WorkingDirectory,
        [Parameter(Mandatory = $true)]
        [string]$WindowTitle,
        [Parameter(Mandatory = $true)]
        [string]$ScriptText
    )

    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($ScriptText))
    Start-Process -FilePath 'powershell.exe' -WorkingDirectory $WorkingDirectory -ArgumentList @(
        '-NoExit',
        '-ExecutionPolicy', 'Bypass',
        '-EncodedCommand', $encoded
    ) | Out-Null
}

function Ensure-BackendVenv {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PythonBootstrapPath
    )

    if (-not (Test-Path -LiteralPath $BackendPython)) {
        Write-Step 'Creating backend virtual environment...'
        & $PythonBootstrapPath -m venv $BackendVenvDir
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to create backend virtual environment.'
        }
    }

    $needsInstall = $ForceInstall.IsPresent
    if (-not $needsInstall) {
        & $BackendPython -c "from importlib.util import find_spec; import sys; modules = ('fastapi', 'uvicorn', 'psycopg'); sys.exit(0 if all(find_spec(module) for module in modules) else 1)" *> $null
        $needsInstall = $LASTEXITCODE -ne 0
    }

    if ($needsInstall) {
        Write-Step 'Installing backend dependencies...'
        & $BackendPython -m pip install -r $BackendRequirements
        if ($LASTEXITCODE -ne 0) {
            throw 'Failed to install backend dependencies.'
        }
    }
}

function Ensure-FrontendDependencies {
    param(
        [Parameter(Mandatory = $true)]
        [string]$PackageManagerPath,
        [Parameter(Mandatory = $true)]
        [string]$PackageManagerName
    )

    $nodeModulesPath = Join-Path $FrontendDir 'node_modules'
    $needsInstall = $ForceInstall.IsPresent -or -not (Test-Path -LiteralPath $nodeModulesPath)

    if (-not $needsInstall) {
        return
    }

    Write-Step "Installing frontend dependencies with $PackageManagerName..."
    Push-Location $FrontendDir
    try {
        if ($PackageManagerName -eq 'pnpm') {
            & $PackageManagerPath install --frozen-lockfile
        } else {
            & $PackageManagerPath install
        }

        if ($LASTEXITCODE -ne 0) {
            throw "Failed to install frontend dependencies with $PackageManagerName."
        }
    } finally {
        Pop-Location
    }
}

function Resolve-ComposeCommand {
    $dockerPath = Find-CommandPath -Candidates @('docker')
    if ($null -ne $dockerPath) {
        & $dockerPath compose version *> $null
        if ($LASTEXITCODE -eq 0) {
            return @{
                Kind       = 'docker'
                Path       = $dockerPath
                DockerPath = $dockerPath
            }
        }
    }

    $dockerComposePath = Find-CommandPath -Candidates @('docker-compose')
    if ($null -ne $dockerComposePath) {
        if ($null -eq $dockerPath) {
            throw 'docker-compose was found, but docker is missing. Docker inspect is required for health checks.'
        }

        return @{
            Kind       = 'docker-compose'
            Path       = $dockerComposePath
            DockerPath = $dockerPath
        }
    }

    throw 'Docker Compose is not available. Install Docker Desktop or docker-compose first.'
}

function Invoke-Compose {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Compose,
        [Parameter(Mandatory = $true)]
        [string[]]$Arguments
    )

    if ($Compose.Kind -eq 'docker') {
        & $Compose.Path compose @Arguments
    } else {
        & $Compose.Path @Arguments
    }

    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose command failed: $($Arguments -join ' ')"
    }
}

function Start-Postgres {
    param([Parameter(Mandatory = $true)][hashtable]$Compose)

    Write-Step 'Starting PostgreSQL container...'
    Invoke-Compose -Compose $Compose -Arguments @('up', '-d', 'postgres')

    Write-Step 'Waiting for PostgreSQL health status...'
    Wait-Until -TimeoutSeconds 120 -TimeoutMessage 'PostgreSQL container did not become healthy in time.' -Condition {
        $inspectOutput = & $Compose.DockerPath inspect '--format' '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $PostgresContainerName 2>$null
        return ($inspectOutput | Select-Object -First 1) -eq 'healthy'
    }
}

function Get-ComposeServiceContainerId {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Compose,
        [Parameter(Mandatory = $true)]
        [string]$ServiceName
    )

    if ($Compose.Kind -eq 'docker') {
        $result = & $Compose.Path compose ps -a -q $ServiceName
    } else {
        $result = & $Compose.Path ps -a -q $ServiceName
    }

    return ($result | Select-Object -First 1)
}

function Test-ContainerHealthy {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DockerPath,
        [Parameter(Mandatory = $true)]
        [string]$ContainerName
    )

    $inspectOutput = & $DockerPath inspect '--format' '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' $ContainerName 2>$null
    return ($inspectOutput | Select-Object -First 1) -eq 'healthy'
}

function Test-ContainerRunning {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DockerPath,
        [Parameter(Mandatory = $true)]
        [string]$ContainerName
    )

    $inspectOutput = & $DockerPath inspect '--format' '{{.State.Status}}' $ContainerName 2>$null
    return ($inspectOutput | Select-Object -First 1) -eq 'running'
}

function Get-PortOwnerSummary {
    param(
        [Parameter(Mandatory = $true)]
        [string]$DockerPath,
        [Parameter(Mandatory = $true)]
        [int[]]$Ports
    )

    $owners = New-Object System.Collections.Generic.List[string]
    foreach ($port in $Ports) {
        $containerNames = & $DockerPath ps --filter "publish=$port" --format '{{.Names}}' 2>$null
        foreach ($containerName in $containerNames) {
            if ($containerName) {
                $owners.Add("${port}: ${containerName}")
            }
        }
    }

    if ($owners.Count -eq 0) {
        return 'unknown non-Docker process'
    }

    return ($owners | Sort-Object -Unique) -join '; '
}

function Assert-MinioPortsAvailableOrOwned {
    param([Parameter(Mandatory = $true)][hashtable]$Compose)

    $portsInUse = @()
    if (Test-TcpPortOpen -Port $MinioPort) {
        $portsInUse += $MinioPort
    }
    if (Test-TcpPortOpen -Port $MinioConsolePort) {
        $portsInUse += $MinioConsolePort
    }

    if ($portsInUse.Count -eq 0) {
        return
    }

    if (Test-ContainerRunning -DockerPath $Compose.DockerPath -ContainerName $MinioContainerName) {
        return
    }

    $portList = ($portsInUse | Sort-Object -Unique) -join ', '
    $ownerSummary = Get-PortOwnerSummary -DockerPath $Compose.DockerPath -Ports $portsInUse
    throw "MinIO ports $portList are already occupied by another process or container ($ownerSummary). Stop the conflicting service, or set S3_ENDPOINT/S3_ACCESS_KEY/S3_SECRET_KEY before starting smart_design to use that external object storage."
}

function Start-Minio {
    param([Parameter(Mandatory = $true)][hashtable]$Compose)

    if ($ExplicitS3Endpoint) {
        Write-Step "Using configured object storage endpoint: $MinioEndpoint"
        return
    }

    Assert-MinioPortsAvailableOrOwned -Compose $Compose

    Write-Step 'Starting MinIO containers...'
    Invoke-Compose -Compose $Compose -Arguments @('up', '-d', 'minio', 'minio-init')

    Write-Step 'Waiting for MinIO health status...'
    Wait-Until -TimeoutSeconds 120 -TimeoutMessage 'MinIO container did not become healthy in time.' -Condition {
        Test-ContainerHealthy -DockerPath $Compose.DockerPath -ContainerName $MinioContainerName
    }

    $minioInitContainerId = Get-ComposeServiceContainerId -Compose $Compose -ServiceName 'minio-init'
    if ($minioInitContainerId) {
        Write-Step 'Waiting for MinIO bucket bootstrap...'
        Wait-Until -TimeoutSeconds 60 -TimeoutMessage 'MinIO bucket bootstrap did not complete in time.' -Condition {
            $exitCode = & $Compose.DockerPath inspect '--format' '{{.State.ExitCode}}' $minioInitContainerId 2>$null
            return ($exitCode | Select-Object -First 1) -eq '0'
        }
    }
}

function Test-Truthy {
    param([string]$Value)

    return $Value.Trim().ToLowerInvariant() -in @('1', 'true', 'yes', 'on')
}

function Start-KkFileView {
    param([Parameter(Mandatory = $true)][hashtable]$Compose)

    if (-not (Test-Truthy -Value $KkFileViewEnabled)) {
        Write-Step 'kkFileView preview is disabled by KKFILEVIEW_ENABLED.'
        return
    }

    if ($KkFileViewBaseUrl -notmatch '^https?://(127\.0\.0\.1|localhost)(:\d+)?/?$') {
        Write-Step "Using configured kkFileView service: $KkFileViewBaseUrl"
        return
    }

    Write-Step 'Starting kkFileView container...'
    Invoke-Compose -Compose $Compose -Arguments @('up', '-d', 'kkfileview')

    Write-Step 'Waiting for kkFileView preview service...'
    Wait-ForHttpOk -Name 'kkFileView' -Url $KkFileViewBaseUrl -TimeoutSeconds 120
}

Assert-PathExists -Path $BackendDir -Message 'Missing backend directory.'
Assert-PathExists -Path $FrontendDir -Message 'Missing frontend directory.'
Assert-PathExists -Path $BackendRequirements -Message 'Missing backend requirements.txt.'

$PythonBootstrapPath = Find-CommandPath -Candidates @('python', 'py')
if ($null -eq $PythonBootstrapPath) {
    throw 'Python was not found in PATH.'
}

$PackageManagerName = if (Test-Path -LiteralPath $FrontendLockfile) { 'pnpm' } else { 'npm' }
$PackageManagerPath = Find-CommandPath -Candidates @($PackageManagerName)
if ($null -eq $PackageManagerPath) {
    throw "$PackageManagerName was not found in PATH."
}

$Compose = Resolve-ComposeCommand

Ensure-BackendVenv -PythonBootstrapPath $PythonBootstrapPath
Ensure-FrontendDependencies -PackageManagerPath $PackageManagerPath -PackageManagerName $PackageManagerName
Start-Postgres -Compose $Compose
Start-Minio -Compose $Compose
Start-KkFileView -Compose $Compose

$backendHealthUrl = "http://127.0.0.1:$BackendPort/health"
$frontendUrl = "http://127.0.0.1:$FrontendPort"

if (Test-TcpPortOpen -Port $BackendPort) {
    Write-Step "Backend port $BackendPort is already in use. Skipping backend launch."
} else {
    Write-Step 'Launching backend window...'
    $backendScript = @"
try {
    `$Host.UI.RawUI.WindowTitle = 'smart_design backend'
} catch {
}
Set-Location -LiteralPath '$(Get-SingleQuotedValue -Value $BackendDir)'
`$env:SMART_DESIGN_ENV = '$(Get-SingleQuotedValue -Value $SmartDesignEnv)'
`$env:DATABASE_URL = '$(Get-SingleQuotedValue -Value $DatabaseUrl)'
`$env:S3_ENDPOINT = '$(Get-SingleQuotedValue -Value $MinioEndpoint)'
`$env:S3_BUCKET = '$(Get-SingleQuotedValue -Value $MinioBucket)'
`$env:S3_ACCESS_KEY = '$(Get-SingleQuotedValue -Value $MinioAccessKey)'
`$env:S3_SECRET_KEY = '$(Get-SingleQuotedValue -Value $MinioSecretKey)'
`$env:KKFILEVIEW_ENABLED = '$(Get-SingleQuotedValue -Value $KkFileViewEnabled)'
`$env:KKFILEVIEW_BASE_URL = '$(Get-SingleQuotedValue -Value $KkFileViewBaseUrl)'
`$env:KKFILEVIEW_KEY = '$(Get-SingleQuotedValue -Value $KkFileViewKey)'
`$env:S3_PREVIEW_ENDPOINT = '$(Get-SingleQuotedValue -Value $S3PreviewEndpoint)'
`$env:SMART_DESIGN_BOOTSTRAP_ADMIN_USERNAME = '$(Get-SingleQuotedValue -Value $BootstrapAdminUsername)'
`$env:SMART_DESIGN_BOOTSTRAP_ADMIN_PASSWORD = '$(Get-SingleQuotedValue -Value $BootstrapAdminPassword)'
`$env:SMART_DESIGN_BOOTSTRAP_ADMIN_DISPLAY_NAME = '$(Get-SingleQuotedValue -Value $BootstrapAdminDisplayName)'
`$env:SMART_DESIGN_BOOTSTRAP_ADMIN_EMAIL = '$(Get-SingleQuotedValue -Value $BootstrapAdminEmail)'
& '$(Get-SingleQuotedValue -Value $BackendPython)' -m uvicorn app.main:app --reload --host 127.0.0.1 --port $BackendPort
"@
    Start-DetachedPowerShell -WorkingDirectory $BackendDir -WindowTitle 'smart_design backend' -ScriptText $backendScript
}

Wait-ForHttpOk -Name 'Backend' -Url $backendHealthUrl -TimeoutSeconds 90

if (Test-TcpPortOpen -Port $FrontendPort) {
    Write-Step "Frontend port $FrontendPort is already in use. Skipping frontend launch."
} else {
    Write-Step 'Launching frontend window...'
    $frontendCommand = if ($PackageManagerName -eq 'pnpm') {
        "& '$(Get-SingleQuotedValue -Value $PackageManagerPath)' dev -- --host 127.0.0.1 --port $FrontendPort --strictPort"
    } else {
        "& '$(Get-SingleQuotedValue -Value $PackageManagerPath)' run dev -- --host 127.0.0.1 --port $FrontendPort --strictPort"
    }

    $frontendScript = @"
try {
    `$Host.UI.RawUI.WindowTitle = 'smart_design frontend'
} catch {
}
Set-Location -LiteralPath '$(Get-SingleQuotedValue -Value $FrontendDir)'
$frontendCommand
"@
    Start-DetachedPowerShell -WorkingDirectory $FrontendDir -WindowTitle 'smart_design frontend' -ScriptText $frontendScript
}

Wait-ForHttpOk -Name 'Frontend' -Url $frontendUrl -TimeoutSeconds 90

Write-Host ''
Write-Host 'smart_design dev environment is ready.' -ForegroundColor Green
Write-Host "Backend:  $backendHealthUrl"
Write-Host "Frontend: $frontendUrl"
Write-Host "MinIO:    $MinioEndpoint"
Write-Host "Preview:  $KkFileViewBaseUrl"
