param(
    [string]$SwfmillExe = $env:SWFMILL_EXE,
    [string]$MtascExe = $env:MTASC_EXE,
    [string]$MtascClassPath = $env:MTASC_CLASSPATH,
    [string]$FfmpegExe = "ffmpeg",
    [switch]$Preview
)

$ErrorActionPreference = "Stop"
$scaleformRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$projectRoot = Resolve-Path (Join-Path $scaleformRoot "..\..\..")
$buildRoot = Join-Path $scaleformRoot "build"
$outputName = if ($Preview) { "rangeratlasmenu-preview.swf" } else { "rangeratlasmenu.swf" }
$entryPoint = if ($Preview) { "RangerAtlasPreview.as" } else { "RangerAtlasMain.as" }
$outputPath = Join-Path $scaleformRoot $outputName

if (-not $SwfmillExe -or -not (Test-Path $SwfmillExe)) {
    throw "Set SWFMILL_EXE to swfmill.exe before building the Scaleform surface."
}
if (-not $MtascExe -or -not (Test-Path $MtascExe)) {
    throw "Set MTASC_EXE to mtasc.exe before building the Scaleform surface."
}
if (-not $MtascClassPath -or -not (Test-Path $MtascClassPath)) {
    throw "Set MTASC_CLASSPATH to MTASC's std8 directory before building the Scaleform surface."
}

New-Item -ItemType Directory -Force -Path $buildRoot | Out-Null
$mapSource = Join-Path $projectRoot "Skyrim-illustrated-map.jpg"
$mapOutput = Join-Path $buildRoot "field-map.jpg"
$mapPng = Join-Path $buildRoot "field-map.png"

& $FfmpegExe -hide_banner -loglevel error -y -i $mapSource `
    -vf "scale=2048:1536:flags=lanczos" `
    -q:v 3 $mapOutput
if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg could not prepare the illustrated map."
}

# Skyrim's Scaleform renderer does not reliably upload one large embedded JPEG.
# Lossless 1024x512 tiles match the bitmap format used by shipped Skyrim menus
# and stay comfortably below the renderer's per-texture limits.
& $FfmpegExe -hide_banner -loglevel error -y -i $mapSource `
    -vf "scale=2048:1536:flags=lanczos,format=rgba" `
    -frames:v 1 $mapPng
if ($LASTEXITCODE -ne 0) {
    throw "ffmpeg could not prepare the lossless illustrated map."
}

for ($row = 0; $row -lt 3; $row += 1) {
    for ($column = 0; $column -lt 2; $column += 1) {
        $tilePath = Join-Path $buildRoot "field-map-$row-$column.png"
        $cropX = $column * 1024
        $cropY = $row * 512
        & $FfmpegExe -hide_banner -loglevel error -y -i $mapPng `
            -vf "crop=1024:512:$cropX`:$cropY" `
            -frames:v 1 $tilePath
        if ($LASTEXITCODE -ne 0) {
            throw "ffmpeg could not prepare illustrated map tile $row,$column."
        }
    }
}

Push-Location $scaleformRoot
try {
    & $SwfmillExe simple "rangeratlasmenu.xml" $outputPath
    if ($LASTEXITCODE -ne 0) {
        throw "swfmill could not create the map asset library."
    }

    & $MtascExe -version 8 -cp $MtascClassPath -swf $outputPath -keep -main $entryPoint
    if ($LASTEXITCODE -ne 0) {
        throw "MTASC could not compile $entryPoint."
    }
} finally {
    Pop-Location
}

Write-Output "Built $outputPath"
