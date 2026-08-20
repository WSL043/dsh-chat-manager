[CmdletBinding()]
param(
    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string]$Profile = 'web',
    [string]$DshPath
)

$ErrorActionPreference = 'Stop'
$PackageSpec = 'dsh-native-session-delete@https://github.com/WSL043/dsh-session-delete/releases/download/v1.0.2/dsh-native-session-delete.tgz'
$Chinese = [Globalization.CultureInfo]::CurrentUICulture.Name -like 'zh-*'

function Say([string]$ChineseText, [string]$EnglishText) {
    Write-Host $(if ($Chinese) { $ChineseText } else { $EnglishText })
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

    if ($discovered.Count -eq 1) { return $discovered[0] }
    if ($discovered.Count -gt 1) {
        throw "Multiple DSH installations were found. Pass -DshPath with the intended dsh.exe:`n$($discovered -join "`n")"
    }
    throw 'DSH was not found in PATH or common Portable locations. Run this command in the DSH-Portable folder or pass -DshPath.'
}

$dsh = Resolve-DshCommand
$timer = [Diagnostics.Stopwatch]::StartNew()
Say "目标：$dsh" "Target: $dsh"
Say "正在通过 DSH 官方插件命令安装…" "Installing through the official DSH plugin command..."

# Equivalent to: dsh plugin --profile web add <fixed Release package>
& $dsh plugin --profile $Profile add $PackageSpec
$code = $LASTEXITCODE
$timer.Stop()
if ($code -ne 0) {
    throw "DSH plugin command failed with exit code $code."
}

Say "安装完成（$([Math]::Round($timer.Elapsed.TotalSeconds, 1)) 秒）。请保存工作并按正常方式重启 DSH。" "Installed in $([Math]::Round($timer.Elapsed.TotalSeconds, 1)) seconds. Save your work and restart DSH normally."
