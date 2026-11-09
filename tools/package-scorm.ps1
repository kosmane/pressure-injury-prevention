param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [switch]$ManifestOnly
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$versions = @('scorm12')
$registryPath = Join-Path $ProjectRoot 'asset-registry.json'
$registry = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8 | ConvertFrom-Json

function Get-PackageFiles {
    param([string]$Root)

    $files = [System.Collections.Generic.List[string]]::new()
    foreach ($rootFile in @('index.html', 'course.json', 'asset-registry.json')) {
        $path = Join-Path $Root $rootFile
        if (Test-Path -LiteralPath $path) { $files.Add($rootFile) }
    }
    foreach ($folder in @('src', 'styles', 'scenes', 'shared')) {
        $folderPath = Join-Path $Root $folder
        if (Test-Path -LiteralPath $folderPath) {
            Get-ChildItem -LiteralPath $folderPath -File -Recurse | Where-Object { $_.Name -ne '.gitkeep' } | ForEach-Object {
                $relative = $_.FullName.Substring($Root.Length).TrimStart('\', '/')
                $relative = $relative.Replace('\', '/')
                $files.Add($relative)
            }
        }
    }
    foreach ($asset in $registry.PSObject.Properties) {
        $relative = ([string]$asset.Value.path).Replace('\', '/')
        if (-not $files.Contains($relative)) { $files.Add($relative) }
    }
    return @($files | Sort-Object -Unique)
}

function New-Manifest {
    param([string]$Version, [string[]]$Files)

    $packagePath = Join-Path $ProjectRoot "package/$Version"
    New-Item -ItemType Directory -Force -Path $packagePath | Out-Null
    $fileTags = ($Files | ForEach-Object { '      <file href="' + [System.Security.SecurityElement]::Escape($_) + '" />' }) -join "`n"
    $manifestPath = Join-Path $packagePath 'imsmanifest.xml'
    if ($Version -eq 'scorm12') {
        $xml = @"
<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="pressure-injury-course-scorm12" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 http://www.imsglobal.org/xsd/imscp_rootv1p1p2.xsd http://www.adlnet.org/xsd/adlcp_rootv1p1p2 http://www.adlnet.org/xsd/adlcp_rootv1p1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="ORG-PRESSURE-INJURY">
    <organization identifier="ORG-PRESSURE-INJURY">
      <title>לומדת פגיעות לחץ</title>
      <item identifier="ITEM-PRESSURE-INJURY" identifierref="RES-PRESSURE-INJURY">
        <title>לומדת פגיעות לחץ</title>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES-PRESSURE-INJURY" type="webcontent" adlcp:scormtype="sco" href="index.html">
$fileTags
    </resource>
  </resources>
</manifest>
"@
    }
    Set-Content -LiteralPath $manifestPath -Value $xml -Encoding UTF8
}

$files = Get-PackageFiles -Root $ProjectRoot
foreach ($version in $versions) { New-Manifest -Version $version -Files $files }

if ($ManifestOnly) {
    Write-Output 'SCORM manifests generated. No ZIP archives were created.'
    return
}

$required = @('index.html', 'course.json', 'asset-registry.json', 'src/app.js', 'src/scene-player.js', 'src/cases.js', 'src/scorm-api.js', 'src/course-data.js', 'styles/course.css', 'shared/logo-assaf-harofeh.png')
foreach ($relative in $required) {
    if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot $relative))) { throw "Required package file is missing: $relative" }
}
$missingAssets = @($registry.PSObject.Properties | Where-Object { -not (Test-Path -LiteralPath (Join-Path $ProjectRoot $_.Value.path)) } | ForEach-Object { [string]$_.Name })
if ($missingAssets.Count -gt 0) { throw "Cannot package before all registered images exist. Missing assets: $($missingAssets -join ', ')" }

$dist = Join-Path $ProjectRoot 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
foreach ($version in $versions) {
    $stage = Join-Path ([System.IO.Path]::GetTempPath()) ("pressure-injury-$version-" + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        foreach ($relative in @('index.html', 'course.json', 'asset-registry.json')) {
            Copy-Item -LiteralPath (Join-Path $ProjectRoot $relative) -Destination (Join-Path $stage $relative)
        }
        foreach ($folder in @('src', 'styles', 'scenes', 'shared')) {
            Copy-Item -LiteralPath (Join-Path $ProjectRoot $folder) -Destination (Join-Path $stage $folder) -Recurse
        }
        Copy-Item -LiteralPath (Join-Path $ProjectRoot "package/$version/imsmanifest.xml") -Destination (Join-Path $stage 'imsmanifest.xml')
        $zipPath = Join-Path $dist "pressure-injury-$version.zip"
        if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }
        Compress-Archive -Path (Join-Path $stage '*') -DestinationPath $zipPath -CompressionLevel Optimal
        Write-Output "Created $zipPath"
    } finally {
        $tempRoot = [System.IO.Path]::GetFullPath([System.IO.Path]::GetTempPath())
        $stageFull = [System.IO.Path]::GetFullPath($stage)
        if ($stageFull.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
            Remove-Item -LiteralPath $stageFull -Recurse -Force
        }
    }
}
