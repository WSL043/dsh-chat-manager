[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Profile = 'web',
    [string]$DshPath
)

$ErrorActionPreference = 'Stop'
$PackageSpec = 'dsh-native-session-delete@1.0.4'
$Chinese = [Globalization.CultureInfo]::CurrentUICulture.Name -like 'zh-*'

function Say([string]$ChineseText, [string]$EnglishText) {
    Write-Host $(if ($Chinese) { $ChineseText } else { $EnglishText })
}

function Select-DshCommand([string[]]$Choices) {
    Say '检测到多个 DSH 安装，请选择：' 'Multiple DSH installations were found. Select one:'
    for ($index = 0; $index -lt $Choices.Count; $index++) {
        Write-Host "$($index + 1). $($Choices[$index])"
    }
    $answer = Read-Host $(if ($Chinese) { '输入编号' } else { 'Enter number' })
    if ($answer -notmatch '^\d+$') { throw 'Invalid DSH selection.' }
    $selected = [int]$answer
    if ($selected -lt 1 -or $selected -gt $Choices.Count) { throw 'Invalid DSH selection.' }
    return $Choices[$selected - 1]
}

function Resolve-DshCommand {
    if ($DshPath) {
        if (-not (Test-Path -LiteralPath $DshPath -PathType Leaf)) {
            throw "DSH executable not found: $DshPath"
        }
        return (Resolve-Path -LiteralPath $DshPath).Path
    }

    $candidates = [Collections.Generic.List[string]]::new()
    $candidates.Add((Join-Path (Get-Location).Path 'dsh.exe'))
    if ($env:DSH_PORTABLE_ROOT) {
        $candidates.Add((Join-Path $env:DSH_PORTABLE_ROOT 'dsh.exe'))
    }

    $command = Get-Command dsh -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($command) { $candidates.Add($command.Source) }

    if ($env:USERPROFILE) {
        $candidates.Add((Join-Path $env:USERPROFILE 'Downloads\DSH-Portable\dsh.exe'))
        $candidates.Add((Join-Path $env:USERPROFILE 'Desktop\DSH-Portable\dsh.exe'))
        $candidates.Add((Join-Path $env:USERPROFILE 'Documents\DSH-Portable\dsh.exe'))
    }

    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            return (Resolve-Path -LiteralPath $candidate).Path
        }
    }

    # Portable archives are often unpacked below a generated folder such as
    # LocalAppData\Temp\opencode\<name>\DSH-Portable. Probe only a few known
    # user roots and at most three directory levels; never recurse over a disk.
    $roots = [Collections.Generic.List[string]]::new()
    if ($env:USERPROFILE) {
        $roots.Add((Join-Path $env:USERPROFILE 'Downloads'))
        $roots.Add((Join-Path $env:USERPROFILE 'Desktop'))
        $roots.Add((Join-Path $env:USERPROFILE 'Documents'))
    }
    if ($env:LOCALAPPDATA) { $roots.Add((Join-Path $env:LOCALAPPDATA 'Temp')) }

    $discovered = [Collections.Generic.List[string]]::new()
    foreach ($root in $roots) {
        if (-not (Test-Path -LiteralPath $root -PathType Container)) { continue }
        foreach ($depth in 0..3) {
            $parts = [Collections.Generic.List[string]]::new()
            foreach ($unused in 1..$depth) { if ($depth -gt 0) { $parts.Add('*') } }
            foreach ($name in @('dsh.exe', 'dsh.cmd')) {
                $partsWithName = @($parts) + $name
                $pattern = Join-Path $root ($partsWithName -join '\')
                Get-Item -Path $pattern -ErrorAction SilentlyContinue | ForEach-Object {
                    if (-not $discovered.Contains($_.FullName)) { $discovered.Add($_.FullName) }
                }
            }
        }
    }

    # A generated LocalAppData\Temp extraction is often only an installer or
    # acceptance fixture. Prefer one durable user installation when it is the
    # sole non-temporary candidate instead of making the user disambiguate it.
    $durable = [Collections.Generic.List[string]]::new()
    $tempRoot = if ($env:LOCALAPPDATA) {
        [IO.Path]::GetFullPath((Join-Path $env:LOCALAPPDATA 'Temp')).TrimEnd('\') + '\'
    }
    foreach ($candidate in $discovered) {
        $full = [IO.Path]::GetFullPath($candidate)
        if (-not $tempRoot -or -not $full.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase)) {
            $durable.Add($candidate)
        }
    }

    if ($durable.Count -eq 1) { return $durable[0] }
    if ($durable.Count -gt 1) {
        return Select-DshCommand @($durable)
    }
    if ($discovered.Count -eq 1) { return $discovered[0] }
    if ($discovered.Count -gt 1) {
        return Select-DshCommand @($discovered)
    }
    throw 'DSH was not found in PATH or common Portable locations. Run this command in the DSH-Portable folder or pass -DshPath.'
}

function Invoke-DshAdd([string]$Command) {
    $lines = [Collections.Generic.List[string]]::new()
    $previousErrorAction = $ErrorActionPreference
    try {
        # Windows PowerShell represents native stderr as ErrorRecord objects.
        # Keep the CLI output visible while retaining plain text for one exact
        # compatibility recovery decision below.
        $ErrorActionPreference = 'Continue'
        & $Command plugin --profile $Profile add $PackageSpec 2>&1 | ForEach-Object {
            $line = $_.ToString()
            $lines.Add($line)
            Write-Host $line
        }
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorAction
    }
    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output = ($lines -join "`n")
    }
}

$dsh = Resolve-DshCommand
$timer = [Diagnostics.Stopwatch]::StartNew()
Say "目标：$dsh" "Target: $dsh"
Say "正在通过 DSH 官方插件命令安装…" "Installing through the official DSH plugin command..."

# Equivalent to: dsh plugin --profile web add <fixed Release package>
$result = Invoke-DshAdd $dsh

# A moved Portable profile can contain a dependency that was already locked
# before pnpm's release-age window elapsed. The Portable launcher then fails
# while rebuilding its links, before this package is considered. Retry only
# that recognized failure once, with a process-local override that disappears
# when this installer exits; no user or profile setting is changed.
if ($result.ExitCode -ne 0 -and $result.Output -match 'ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION') {
    Say 'DSH 的现有依赖触发了发布时间限制，正在对同一固定版本进行一次兼容重试…' 'An existing DSH dependency hit the release-age policy; retrying the same pinned install once...'
    $previousReleaseAge = [Environment]::GetEnvironmentVariable('PNPM_CONFIG_MINIMUM_RELEASE_AGE', 'Process')
    try {
        $env:PNPM_CONFIG_MINIMUM_RELEASE_AGE = '0'
        $result = Invoke-DshAdd $dsh
    }
    finally {
        if ($null -eq $previousReleaseAge) {
            [Environment]::SetEnvironmentVariable('PNPM_CONFIG_MINIMUM_RELEASE_AGE', $null, 'Process')
        }
        else {
            $env:PNPM_CONFIG_MINIMUM_RELEASE_AGE = $previousReleaseAge
        }
    }
}

$timer.Stop()
if ($result.ExitCode -ne 0) {
    throw "DSH plugin command failed with exit code $($result.ExitCode)."
}

Say "安装完成（$([Math]::Round($timer.Elapsed.TotalSeconds, 1)) 秒）。请保存工作并按正常方式重启 DSH。" "Installed in $([Math]::Round($timer.Elapsed.TotalSeconds, 1)) seconds. Save your work and restart DSH normally."
