param(
    [string]$Source = (Join-Path $PSScriptRoot "../../keizaal-wayfinder/assets/discord-role-icons/samples-v4"),
    [string]$Target = "assets/ranger-profile",
    [int]$Size = 128
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
New-Item -ItemType Directory -Force -Path $Target | Out-Null
$targetPath = (Resolve-Path $Target).Path

Get-ChildItem -LiteralPath $Source -Filter *.png | ForEach-Object {
    $inputImage = [System.Drawing.Image]::FromFile($_.FullName)
    try {
        $bitmap = New-Object System.Drawing.Bitmap $Size, $Size
        try {
            $bitmap.SetResolution(96, 96)
            $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
            try {
                $graphics.Clear([System.Drawing.Color]::Transparent)
                $graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
                $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
                $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
                $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
                $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
                $graphics.DrawImage($inputImage, 0, 0, $Size, $Size)
            } finally {
                $graphics.Dispose()
            }
            $bitmap.Save((Join-Path $targetPath $_.Name), [System.Drawing.Imaging.ImageFormat]::Png)
        } finally {
            $bitmap.Dispose()
        }
    } finally {
        $inputImage.Dispose()
    }
}
