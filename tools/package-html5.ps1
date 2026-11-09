param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot)
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$required = @('index.html', 'course.json', 'asset-registry.json', 'src', 'styles', 'scenes', 'shared', 'README.md')
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relative))) {
        throw "Required HTML5 package content is missing: $relative"
    }
}
$registry = Get-Content -LiteralPath (Join-Path $ProjectRoot 'asset-registry.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$missing = @($registry.PSObject.Properties | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ProjectRoot $_.Value.path)) } | ForEach-Object { [string]$_.Name })
if ($missing.Count -gt 0) { throw "Cannot package before all registered images exist. Missing assets: $($missing -join ', ')" }

$dist = Join-Path $ProjectRoot 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
$stage = Join-Path $tempRoot ('pressure-injury-html5-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
try {
    foreach ($relative in @('index.html', 'course.json', 'asset-registry.json', 'README.md', 'src', 'styles', 'scenes', 'shared')) {
        Copy-Item -LiteralPath (Join-Path $ProjectRoot $relative) -Destination (Join-Path $stage $relative) -Recurse
    }
    $archive = Join-Path $dist 'pressure-injury-html5.zip'
    Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $archive -CompressionLevel Optimal -Force
    Write-Output "Created $archive"
} finally {
    $stageFull = [System.IO.Path]::GetFullPath($stage)
    if ($stageFull.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $stageFull -Recurse -Force
    }
}
