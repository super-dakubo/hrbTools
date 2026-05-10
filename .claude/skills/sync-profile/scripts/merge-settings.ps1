param(
    [Parameter(Mandatory=$true)]
    [string]$SeedPath,
    [Parameter(Mandatory=$true)]
    [string]$TargetPath
)

# 读取种子包配置和当前用户配置
$seedJson = Get-Content "$SeedPath/config/global-settings.json" | ConvertFrom-Json
$currentJson = @{}
if (Test-Path $TargetPath) {
    $currentJson = Get-Content $TargetPath | ConvertFrom-Json
}

# 合并 allow 数组
$currentAllow = @()
if ($currentJson.permissions.allow) {
    $currentAllow = @($currentJson.permissions.allow)
}
$seedAllow = @($seedJson.permissions.allow)
$mergedAllow = $currentAllow + $seedAllow | Select-Object -Unique

# 合并 deny 数组
$currentDeny = @()
if ($currentJson.permissions.deny) {
    $currentDeny = @($currentJson.permissions.deny)
}
$seedDeny = @($seedJson.permissions.deny)
$mergedDeny = $currentDeny + $seedDeny | Select-Object -Unique

# 更新配置
if ($currentJson.permissions) {
    $currentJson.permissions.allow = $mergedAllow
    $currentJson.permissions.deny = $mergedDeny
} else {
    $currentJson | Add-Member -Name "permissions" -Value @{
        allow = $mergedAllow
        deny = $mergedDeny
        defaultMode = "acceptEdits"
    } -MemberType NoteProperty
}

# 写回
$currentJson | ConvertTo-Json -Depth 10 | Set-Content $TargetPath -Encoding UTF8

Write-Host "Merged permissions: $($mergedAllow.Count) allow, $($mergedDeny.Count) deny items"
