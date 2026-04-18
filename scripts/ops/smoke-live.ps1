param(
  [string]$AdminBaseUrl = "https://g1n8ykcoyj32pb84vq3b7dms.104.238.176.73.sslip.io",
  [string]$PublicBaseUrl = "http://re1oz35delag2o3sgromqlmf.104.238.176.73.sslip.io",
  [string]$ApiBaseUrl = "https://q7hn0ohc20ng48s8xmfjvi4e.104.238.176.73.sslip.io",
  [int]$Take = 20,
  [switch]$Strict,
  [switch]$InsecureTls
)

$ErrorActionPreference = "Stop"

if (-not $PSBoundParameters.ContainsKey("InsecureTls")) {
  $InsecureTls = $true
}

$script:FailureCount = 0
$script:WarnCount = 0

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "=== $Title ==="
}

function Add-Failure([string]$Message) {
  $script:FailureCount += 1
  Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Add-Warn([string]$Message) {
  $script:WarnCount += 1
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Add-Ok([string]$Message) {
  Write-Host "[OK] $Message" -ForegroundColor Green
}

function Invoke-HttpStatus(
  [string]$Name,
  [string]$Url,
  [int[]]$AllowedStatuses
) {
  $args = @("-s", "-o", "NUL", "-w", "%{http_code}", "--max-time", "20")
  if ($InsecureTls -and $Url.StartsWith("https://")) {
    $args += "-k"
  }
  $args += $Url

  $statusRaw = & curl.exe @args
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($statusRaw)) {
    Add-Failure "$Name ulasilamadi ($Url)"
    return $null
  }

  $status = 0
  if (-not [int]::TryParse($statusRaw.Trim(), [ref]$status)) {
    Add-Failure "$Name gecersiz HTTP kodu: $statusRaw"
    return $null
  }

  if ($AllowedStatuses -contains $status) {
    Add-Ok "$Name -> $status"
  }
  else {
    Add-Failure "$Name beklenmeyen durum kodu: $status (beklenen: $($AllowedStatuses -join ','))"
  }

  return $status
}

function Invoke-JsonGet([string]$Url) {
  $args = @("-s", "--max-time", "30")
  if ($InsecureTls -and $Url.StartsWith("https://")) {
    $args += "-k"
  }
  $args += $Url

  $json = & curl.exe @args
  if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($json)) {
    throw "JSON endpoint ulasilamadi: $Url"
  }

  return $json | ConvertFrom-Json
}

Write-Section "Live Smoke"
Write-Host "Admin:  $AdminBaseUrl"
Write-Host "Public: $PublicBaseUrl"
Write-Host "API:    $ApiBaseUrl"
Write-Host "Time:   $(Get-Date -Format s)"

Write-Section "Admin"
$null = Invoke-HttpStatus -Name "Admin root" -Url "$AdminBaseUrl/" -AllowedStatuses @(200)
$null = Invoke-HttpStatus -Name "Admin health" -Url "$AdminBaseUrl/health" -AllowedStatuses @(200)
$null = Invoke-HttpStatus -Name "Admin login" -Url "$AdminBaseUrl/admin/login" -AllowedStatuses @(200)
$null = Invoke-HttpStatus -Name "Admin dashboard route" -Url "$AdminBaseUrl/admin/dashboard" -AllowedStatuses @(200, 302, 303, 307)
$null = Invoke-HttpStatus -Name "Admin providers health route" -Url "$AdminBaseUrl/admin/providers/health" -AllowedStatuses @(200, 302, 303, 307)
$null = Invoke-HttpStatus -Name "Admin security env-check route" -Url "$AdminBaseUrl/admin/security/environment-checks" -AllowedStatuses @(200, 302, 303, 307)

Write-Section "Public"
$null = Invoke-HttpStatus -Name "Public panel" -Url "$PublicBaseUrl/panel" -AllowedStatuses @(200)
$null = Invoke-HttpStatus -Name "Public futbol tahminler" -Url "$PublicBaseUrl/futbol/tahminler" -AllowedStatuses @(200)
$null = Invoke-HttpStatus -Name "Public basketbol tahminler" -Url "$PublicBaseUrl/basketbol/tahminler" -AllowedStatuses @(200)

Write-Section "API"
$null = Invoke-HttpStatus -Name "API health" -Url "$ApiBaseUrl/api/v1/health" -AllowedStatuses @(200)

$predictionsUrl = "$PublicBaseUrl/api/v1/predictions?status=scheduled,live&sport=football&take=$Take"
try {
  $payload = Invoke-JsonGet -Url $predictionsUrl

  if ($payload.success -ne $true) {
    Add-Failure "Public predictions envelope success=false"
  }
  else {
    Add-Ok "Public predictions envelope success=true"
  }

  $items = @($payload.data)
  $count = $items.Count
  if ($count -le 0) {
    Add-Failure "Public predictions data bos (count=0)"
  }
  else {
    Add-Ok "Public predictions data count=$count"
  }

  $missingTeam = $items | Where-Object {
    [string]::IsNullOrWhiteSpace($_.homeTeam) -or
    [string]::IsNullOrWhiteSpace($_.awayTeam)
  }

  if (@($missingTeam).Count -gt 0) {
    Add-Warn "Bazi kayitlarda takim adi eksik: $(@($missingTeam).Count)"
  }
  else {
    Add-Ok "Takim adlari dolu"
  }

  $fallbackCount = @($items | Where-Object { $_.summary -match "gecici tahmin" }).Count
  if ($fallbackCount -gt 0) {
    Add-Warn "Gecici tahmin metni gorulen kayit sayisi: $fallbackCount"
  }
  else {
    Add-Ok "Gecici tahmin fallback metni yok"
  }
}
catch {
  Add-Failure "Predictions JSON kontrolu basarisiz: $($_.Exception.Message)"
}

Write-Section "Summary"
Write-Host "Failures: $script:FailureCount"
Write-Host "Warnings: $script:WarnCount"

if ($script:FailureCount -gt 0) {
  if ($Strict) {
    exit 2
  }
  exit 1
}

exit 0

