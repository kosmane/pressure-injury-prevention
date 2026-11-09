param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$coursePath = Join-Path $ProjectRoot 'course.json'
$registryPath = Join-Path $ProjectRoot 'asset-registry.json'
$outputPath = Join-Path $ProjectRoot 'src/course-data.js'

if (-not (Test-Path -LiteralPath $coursePath)) { throw "Missing source: $coursePath" }
if (-not (Test-Path -LiteralPath $registryPath)) { throw "Missing source: $registryPath" }

$course = Get-Content -LiteralPath $coursePath -Raw -Encoding UTF8 | ConvertFrom-Json
$registry = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8 | ConvertFrom-Json
$courseJson = $course | ConvertTo-Json -Depth 100 -Compress
$registryJson = $registry | ConvertTo-Json -Depth 100 -Compress
$js = "window.COURSE_DATA = $courseJson;`nwindow.ASSET_REGISTRY = $registryJson;`n"
Set-Content -LiteralPath $outputPath -Value $js -Encoding UTF8
Write-Output "Generated $outputPath"
