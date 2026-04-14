param(
  [ValidateSet("local", "production")]
  [string]$Mode = "local",
  [string]$EnvFile = ".env",
  [string]$ApiBaseUrl = "",
  [string]$PublicWebUrl = "",
  [string]$AdminWebUrl = ""
)

$ErrorActionPreference = "Stop"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "=== $Title ==="
}

function Parse-EnvFile([string]$Path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) {
    return $map
  }

  Get-Content -LiteralPath $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line.Length -eq 0 -or $line.StartsWith("#")) {
      return
    }

    $eq = $line.IndexOf("=")
    if ($eq -le 0) {
      return
    }

    $key = $line.Substring(0, $eq).Trim()
    $value = $line.Substring($eq + 1)
    $map[$key] = $value
  }

  return $map
}

function Resolve-Setting([hashtable]$EnvMap, [string]$Key, [string]$Fallback = "") {
  $processValue = [Environment]::GetEnvironmentVariable($Key)
  if (-not [string]::IsNullOrWhiteSpace($processValue)) {
    return $processValue
  }

  if ($EnvMap.ContainsKey($Key) -and -not [string]::IsNullOrWhiteSpace($EnvMap[$Key])) {
    return $EnvMap[$Key]
  }

  return $Fallback
}

function Check-Key([hashtable]$EnvMap, [string]$Key) {
  $value = Resolve-Setting -EnvMap $EnvMap -Key $Key
  if ([string]::IsNullOrWhiteSpace($value)) {
    return "MISSING"
  }
  return "SET"
}

function Parse-DatabaseSummary([string]$DatabaseUrl) {
  if ([string]::IsNullOrWhiteSpace($DatabaseUrl)) {
    return "DATABASE_URL missing"
  }

  try {
    $uri = [System.Uri]$DatabaseUrl
    return "host=$($uri.Host) port=$($uri.Port) db=$($uri.AbsolutePath.TrimStart('/'))"
  }
  catch {
    return "DATABASE_URL parse failed"
  }
}

function Invoke-Check([string]$Name, [string]$Url) {
  if ([string]::IsNullOrWhiteSpace($Url)) {
    Write-Host "${Name}: SKIPPED (url missing)"
    return
  }

  try {
    $response = Invoke-WebRequest -Uri $Url -Method GET -UseBasicParsing -TimeoutSec 20
    Write-Host "${Name}: OK ($($response.StatusCode))"
  }
  catch {
    if ($_.Exception.Response -and $_.Exception.Response.StatusCode) {
      $status = [int]$_.Exception.Response.StatusCode
      Write-Host "${Name}: FAIL ($status)"
      return
    }
    Write-Host "${Name}: FAIL ($($_.Exception.Message))"
  }
}

$envMap = Parse-EnvFile -Path $EnvFile

$resolvedApiBaseUrl = if ([string]::IsNullOrWhiteSpace($ApiBaseUrl)) { Resolve-Setting -EnvMap $envMap -Key "API_URL" -Fallback "http://localhost:4000" } else { $ApiBaseUrl }
$resolvedPublicWebUrl = if ([string]::IsNullOrWhiteSpace($PublicWebUrl)) { Resolve-Setting -EnvMap $envMap -Key "PUBLIC_WEB_URL" -Fallback "http://localhost:3000" } else { $PublicWebUrl }
$resolvedAdminWebUrl = if ([string]::IsNullOrWhiteSpace($AdminWebUrl)) { Resolve-Setting -EnvMap $envMap -Key "ADMIN_WEB_URL" -Fallback "http://localhost:3100" } else { $AdminWebUrl }
$databaseUrl = Resolve-Setting -EnvMap $envMap -Key "DATABASE_URL"

Write-Section "Runtime"
Write-Host "Mode: $Mode"
Write-Host "Env file: $EnvFile"
Write-Host "API: $resolvedApiBaseUrl"
Write-Host "Public: $resolvedPublicWebUrl"
Write-Host "Admin: $resolvedAdminWebUrl"
Write-Host "Database: $(Parse-DatabaseSummary -DatabaseUrl $databaseUrl)"

Write-Section "Env Keys"
$commonKeys = @(
  "DATABASE_URL",
  "REDIS_URL",
  "JWT_ACCESS_SECRET",
  "JWT_REFRESH_SECRET",
  "FOOTBALL_DATA_API_KEY",
  "THE_SPORTS_DB_API_KEY"
)

$productionKeys = @(
  "SUPABASE_DB_POOLER_URL",
  "SUPABASE_DB_DIRECT_URL",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY"
)

$optionalKeys = @(
  "API_FOOTBALL_API_KEY",
  "API_BASKETBALL_API_KEY",
  "API_NBA_API_KEY",
  "SPORTAPI_AI_API_KEY",
  "BALL_DONT_LIE_API_KEY",
  "ODDS_API_IO_API_KEY"
)

foreach ($key in $commonKeys) {
  Write-Host "${key}: $(Check-Key -EnvMap $envMap -Key $key)"
}

if ($Mode -eq "production") {
  foreach ($key in $productionKeys) {
    Write-Host "${key}: $(Check-Key -EnvMap $envMap -Key $key)"
  }
}

Write-Host "--- optional provider keys ---"
foreach ($key in $optionalKeys) {
  Write-Host "${key}: $(Check-Key -EnvMap $envMap -Key $key)"
}

Write-Section "HTTP Checks"
Invoke-Check -Name "API health" -Url "$resolvedApiBaseUrl/api/v1/health"
Invoke-Check -Name "Public dashboard" -Url "$resolvedPublicWebUrl/dashboard"
Invoke-Check -Name "Public predictions" -Url "$resolvedPublicWebUrl/predictions"
Invoke-Check -Name "Admin login" -Url "$resolvedAdminWebUrl/admin/login"

Write-Section "Done"
Write-Host "Validation completed."
