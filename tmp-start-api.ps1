Set-Location "d:\sporx\sports-analytics-platform"
Get-Content .env | ForEach-Object {
  if ($_ -match '^\s*$' -or $_ -match '^\s*#') { return }
  $parts = $_ -split '=',2
  if ($parts.Length -eq 2) {
    $name = $parts[0].Trim()
    $value = $parts[1]
    [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}
node apps/api/dist/apps/api/src/main.js
