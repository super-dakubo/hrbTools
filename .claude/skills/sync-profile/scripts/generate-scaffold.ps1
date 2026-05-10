param(
    [Parameter(Mandatory=$true)]
    [string]$SeedPath,
    [Parameter(Mandatory=$true)]
    [string]$ProjectPath,
    [Parameter(Mandatory=$true)]
    [string]$ScaffoldType
)

$scaffoldDir = "$SeedPath/scaffolds/$ScaffoldType"
if (-not (Test-Path $scaffoldDir)) {
    Write-Error "Scaffold type '$ScaffoldType' not found at $scaffoldDir"
    exit 1
}

# 复制每个模板文件，去掉 .hbs 后缀
Get-ChildItem $scaffoldDir -Filter "*.hbs" | ForEach-Object {
    $targetName = $_.Name -replace '\.hbs$', ''
    $targetPath = "$ProjectPath/$targetName"
    $content = Get-Content $_.FullName -Raw

    # 确保目标目录存在
    $targetDir = Split-Path $targetPath -Parent
    if (-not (Test-Path $targetDir)) {
        New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    }

    Set-Content -Path $targetPath -Value $content -Encoding UTF8
    Write-Host "Generated: $targetPath"
}

Write-Host "Scaffold '$ScaffoldType' applied to $ProjectPath"
