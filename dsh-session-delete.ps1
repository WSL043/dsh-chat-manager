[CmdletBinding()]
param(
    [ValidateSet('Install', 'Update', 'Uninstall')]
    [string] $Action = 'Install',

    [ValidatePattern('^[A-Za-z0-9._-]+$')]
    [string] $Profile = 'web',

    [string] $PortableRoot,

    [string] $DshHome,

    [string] $DshExecutable,

    [string] $NodeExecutable,

    [string] $CommandRoot,

    [switch] $NoModifyPath,

    [switch] $Managed,

    [switch] $SkipSelfUpdate,

    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2.0
$Utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = $Utf8NoBom
$OutputEncoding = $Utf8NoBom

if ($Managed -and -not $PSBoundParameters.ContainsKey('Action')) {
    Write-Host 'Usage: dsh-session-delete <install|update|uninstall>'
    exit 0
}

$PackageName = '@deepseek-ai/dsh-client-ui-workspace'
$LegacyPackageName = 'dsh-session-delete'
$ManagerScriptName = 'dsh-session-delete-manager.ps1'
$LegacyManagerScriptName = 'dsh-session-delete.ps1'
$ManagerShimName = 'dsh-session-delete.cmd'
$ManagerStateName = 'install-state.json'
$PackageVersion = '0.1.7'
$PackageUrl = 'https://github.com/WSL043/dsh-session-delete/releases/download/v0.1.7/dsh-session-delete.tgz'
$PackageSpec = "$PackageName@$PackageUrl"
$PnpmVersion = '11.19.0'
$PnpmUrl = 'https://registry.npmjs.org/pnpm/-/pnpm-11.19.0.tgz'
$PnpmSha512 = '7881F3ED590D472C4A955E2B88B2121791116066DCC88CBCA3849EC9B60F1BBAA6D2CCB221FA91DA4E1C65BEF2BCBE379365AEA7AC539C7BF86DEDC3A1B22DCE'
$ReleaseApi = if ($env:DSH_SESSION_DELETE_RELEASE_API) { $env:DSH_SESSION_DELETE_RELEASE_API } else { 'https://api.github.com/repos/WSL043/dsh-session-delete/releases/latest' }
$ReleaseBase = if ($env:DSH_SESSION_DELETE_RELEASE_BASE) { $env:DSH_SESSION_DELETE_RELEASE_BASE.TrimEnd('/') } else { 'https://github.com/WSL043/dsh-session-delete/releases/download' }

function Get-FileDigest {
    param(
        [Parameter(Mandatory = $true)][string] $Path,
        [ValidateSet('SHA256', 'SHA512')][string] $Algorithm
    )

    $hasher = if ($Algorithm -eq 'SHA512') {
        [System.Security.Cryptography.SHA512]::Create()
    } else {
        [System.Security.Cryptography.SHA256]::Create()
    }
    $stream = [System.IO.File]::OpenRead($Path)
    try {
        return ([System.BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-', '')
    } finally {
        $stream.Dispose()
        $hasher.Dispose()
    }
}

function Get-ManagerCommandRoot {
    if ($CommandRoot) { return Resolve-FullPath $CommandRoot }
    if ($Managed -and $PSCommandPath) { return Split-Path -Parent (Resolve-FullPath $PSCommandPath) }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required to install the dsh-session-delete command.' }
    return Join-Path $env:LOCALAPPDATA 'Programs\dsh-session-delete'
}

function Invoke-LatestManager {
    param([Parameter(Mandatory = $true)][string] $InstalledCommandRoot)

    Write-Host 'Checking the latest immutable release...'
    $releaseSeparator = if ($ReleaseApi.Contains('?')) { '&' } else { '?' }
    $releaseUri = $ReleaseApi + $releaseSeparator + 'cache_bust=' + [DateTime]::UtcNow.Ticks
    $releaseResponse = Invoke-WebRequest -UseBasicParsing -Uri $releaseUri -Headers @{
        Accept = 'application/vnd.github+json'
        'Cache-Control' = 'no-cache'
        Pragma = 'no-cache'
        'User-Agent' = 'dsh-session-delete'
    }
    try {
        $release = $releaseResponse.Content | ConvertFrom-Json
    } catch {
        throw 'GitHub returned unreadable latest-release metadata.'
    }
    $tag = [string] $release.tag_name
    if ($tag -notmatch '^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$') {
        throw "GitHub returned an invalid release tag: $tag"
    }

    $stage = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-session-delete-update-' + [guid]::NewGuid().ToString('N'))
    $latestScript = Join-Path $stage 'dsh-session-delete.ps1'
    $checksumFile = Join-Path $stage 'dsh-session-delete.ps1.sha256'
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        $assetBase = "$ReleaseBase/$tag"
        Invoke-WebRequest -UseBasicParsing -Uri "$assetBase/dsh-session-delete.ps1" -OutFile $latestScript
        Invoke-WebRequest -UseBasicParsing -Uri "$assetBase/dsh-session-delete.ps1.sha256" -OutFile $checksumFile
        $checksumText = Get-Content -LiteralPath $checksumFile -Raw
        $match = [regex]::Match($checksumText, '(?im)^\s*([a-f0-9]{64})\s+\*?dsh-session-delete\.ps1\s*$')
        if (-not $match.Success) { throw 'The release manager checksum file is invalid.' }
        $expectedHash = $match.Groups[1].Value.ToUpperInvariant()
        $actualHash = Get-FileDigest -Algorithm SHA256 -Path $latestScript
        if ($actualHash -ne $expectedHash) {
            throw "Release manager checksum mismatch. Expected $expectedHash, received $actualHash."
        }

        $arguments = @(
            '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
            '-File', $latestScript,
            '-Managed', '-SkipSelfUpdate', '-Action', $Action,
            '-Profile', $Profile,
            '-CommandRoot', $InstalledCommandRoot
        )
        if ($PortableRoot) { $arguments += @('-PortableRoot', $PortableRoot) }
        if ($NoModifyPath) { $arguments += '-NoModifyPath' }
        & powershell.exe @arguments
        if ($LASTEXITCODE -ne 0) { throw "The latest release manager failed with exit code $LASTEXITCODE." }
    } finally {
        if (Test-Path -LiteralPath $stage) {
            Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Test-SamePath {
    param(
        [Parameter(Mandatory = $true)][string] $Left,
        [Parameter(Mandatory = $true)][string] $Right
    )
    try {
        $leftPath = (Resolve-FullPath $Left).TrimEnd('\')
        $rightPath = (Resolve-FullPath $Right).TrimEnd('\')
        return [string]::Equals($leftPath, $rightPath, [System.StringComparison]::OrdinalIgnoreCase)
    } catch {
        return [string]::Equals($Left.Trim(), $Right.Trim(), [System.StringComparison]::OrdinalIgnoreCase)
    }
}

function Add-UserPathEntry {
    param(
        [AllowNull()][AllowEmptyString()][string] $UserPath,
        [Parameter(Mandatory = $true)][string] $Directory
    )

    foreach ($entry in @(([string] $UserPath).Split(';'))) {
        if ($entry.Trim() -and (Test-SamePath -Left $entry -Right $Directory)) {
            return [string] $UserPath
        }
    }
    if (-not $UserPath) { return $Directory }

    # Always add our own separator. If the existing value already ends in one,
    # removing this suffix can still restore the original text byte-for-byte.
    return $UserPath + ';' + $Directory
}

function Remove-UserPathEntry {
    param(
        [AllowNull()][AllowEmptyString()][string] $UserPath,
        [Parameter(Mandatory = $true)][string] $Directory
    )

    if (-not $UserPath) { return [string] $UserPath }

    $lastSeparator = $UserPath.LastIndexOf(';')
    if ($lastSeparator -ge 0) {
        $lastEntry = $UserPath.Substring($lastSeparator + 1)
        if ($lastEntry.Trim() -and (Test-SamePath -Left $lastEntry -Right $Directory)) {
            return $UserPath.Substring(0, $lastSeparator)
        }
    } elseif (Test-SamePath -Left $UserPath -Right $Directory) {
        return ''
    }

    $kept = New-Object System.Collections.Generic.List[string]
    foreach ($entry in $UserPath.Split(';')) {
        if ($entry.Trim() -and (Test-SamePath -Left $entry -Right $Directory)) { continue }
        $kept.Add($entry)
    }
    return $kept -join ';'
}

function Publish-UserPathChange {
    try {
        if (-not ('DshSessionDelete.NativeMethods' -as [type])) {
            Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace DshSessionDelete {
    public static class NativeMethods {
        [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern IntPtr SendMessageTimeout(
            IntPtr hWnd,
            uint message,
            UIntPtr wParam,
            string lParam,
            uint flags,
            uint timeout,
            out UIntPtr result);
    }
}
'@
        }
        [UIntPtr] $result = [UIntPtr]::Zero
        # HWND_BROADCAST + WM_SETTINGCHANGE with SMTO_ABORTIFHUNG.
        [void] [DshSessionDelete.NativeMethods]::SendMessageTimeout(
            [IntPtr] 0xffff,
            0x001A,
            [UIntPtr]::Zero,
            'Environment',
            0x0002,
            2000,
            [ref] $result
        )
    } catch {
        Write-Warning 'The user PATH was updated, but Windows did not accept the environment refresh notification.'
    }
}

function Add-ManagerToUserPath {
    param([Parameter(Mandatory = $true)][string] $Directory)

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $updated = Add-UserPathEntry -UserPath $userPath -Directory $Directory
    if ([string]::Equals([string] $updated, [string] $userPath, [System.StringComparison]::Ordinal)) { return $false }
    [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
    Publish-UserPathChange
    return $true
}

function Remove-ManagerFromUserPath {
    param([Parameter(Mandatory = $true)][string] $Directory)

    $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    if (-not $userPath) { return }
    $updated = Remove-UserPathEntry -UserPath $userPath -Directory $Directory
    if ([string]::Equals([string] $updated, [string] $userPath, [System.StringComparison]::Ordinal)) { return }
    [Environment]::SetEnvironmentVariable('Path', $updated, 'User')
    Publish-UserPathChange
}

function Start-ManagerCleanup {
    param([Parameter(Mandatory = $true)][string] $Directory)

    $installedScript = Join-Path $Directory $ManagerScriptName
    $installedShim = Join-Path $Directory $ManagerShimName
    if (-not (Test-Path -LiteralPath $installedScript -PathType Leaf) -or
        -not (Test-Path -LiteralPath $installedShim -PathType Leaf)) {
        throw 'Refusing to clean an unrecognized manager command directory.'
    }

    $cleanupScript = Join-Path ([System.IO.Path]::GetTempPath()) ('dsh-session-delete-cleanup-' + [guid]::NewGuid().ToString('N') + '.ps1')
    $cleanup = @'
param(
    [int] $ParentId,
    [string] $DirectoryBase64,
    [string] $CleanupBase64
)
$ErrorActionPreference = 'SilentlyContinue'
$directory = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($DirectoryBase64))
$cleanupScript = [Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($CleanupBase64))
try {
    Wait-Process -Id $ParentId -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 300
    foreach ($name in @('dsh-session-delete-manager.ps1', 'dsh-session-delete.ps1', 'dsh-session-delete.cmd', 'install-state.json')) {
        Remove-Item -LiteralPath (Join-Path $directory $name) -Force -ErrorAction SilentlyContinue
    }
    if ((Test-Path -LiteralPath $directory -PathType Container) -and
        -not (Get-ChildItem -LiteralPath $directory -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
        Remove-Item -LiteralPath $directory -Force -ErrorAction SilentlyContinue
    }
} finally {
    Remove-Item -LiteralPath $cleanupScript -Force -ErrorAction SilentlyContinue
}
'@
    [System.IO.File]::WriteAllText($cleanupScript, $cleanup, $Utf8NoBom)
    $directoryBase64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($Directory))
    $cleanupBase64 = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($cleanupScript))
    $argumentLine = "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$cleanupScript`" -ParentId $PID -DirectoryBase64 $directoryBase64 -CleanupBase64 $cleanupBase64"
    Start-Process -FilePath 'powershell.exe' -ArgumentList $argumentLine -WindowStyle Hidden | Out-Null
}

function Remove-ManagerCommand {
    param(
        [Parameter(Mandatory = $true)][string] $Directory,
        [bool] $RemovePath
    )

    if ($RemovePath) { Remove-ManagerFromUserPath -Directory $Directory }
    if (Test-Path -LiteralPath $Directory -PathType Container) {
        $installedScript = Join-Path $Directory $ManagerScriptName
        if ($Managed -and $PSCommandPath -and (Test-SamePath -Left $PSCommandPath -Right $installedScript)) {
            Start-ManagerCleanup -Directory $Directory
            return
        }
        foreach ($ownedFile in @($ManagerScriptName, $LegacyManagerScriptName, $ManagerShimName, $ManagerStateName)) {
            $ownedPath = Join-Path $Directory $ownedFile
            if (Test-Path -LiteralPath $ownedPath -PathType Leaf) {
                Remove-Item -LiteralPath $ownedPath -Force
            }
        }
        if (-not (Get-ChildItem -LiteralPath $Directory -Force -ErrorAction SilentlyContinue | Select-Object -First 1)) {
            Remove-Item -LiteralPath $Directory -Force
        }
    }
}

function Install-ManagerCommand {
    param([Parameter(Mandatory = $true)][string] $Directory)

    if (-not $PSCommandPath -or -not (Test-Path -LiteralPath $PSCommandPath -PathType Leaf)) {
        throw 'The manager command can only be installed from a downloaded script file.'
    }
    New-Item -ItemType Directory -Force -Path $Directory | Out-Null
    $installedScript = Join-Path $Directory $ManagerScriptName
    if (-not (Test-SamePath -Left $PSCommandPath -Right $installedScript)) {
        $stagedScript = Join-Path $Directory ('.dsh-session-delete-' + [guid]::NewGuid().ToString('N') + '.ps1')
        try {
            Copy-Item -LiteralPath $PSCommandPath -Destination $stagedScript
            Move-Item -LiteralPath $stagedScript -Destination $installedScript -Force
        } finally {
            if (Test-Path -LiteralPath $stagedScript) {
                Remove-Item -LiteralPath $stagedScript -Force -ErrorAction SilentlyContinue
            }
        }
    }

    $legacyInstalledScript = Join-Path $Directory $LegacyManagerScriptName
    if (Test-Path -LiteralPath $legacyInstalledScript -PathType Leaf) {
        Remove-Item -LiteralPath $legacyInstalledScript -Force
    }

    $shim = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0dsh-session-delete-manager.ps1" -Managed %*
exit /b %ERRORLEVEL%
'@
    [System.IO.File]::WriteAllText((Join-Path $Directory $ManagerShimName), $shim, [System.Text.Encoding]::ASCII)
    if ($NoModifyPath) { return $false }
    return Add-ManagerToUserPath -Directory $Directory
}

function Resolve-FullPath {
    param([Parameter(Mandatory = $true)][string] $Path)
    return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($Path))
}

function Read-ManagerState {
    param([Parameter(Mandatory = $true)][string] $Directory)

    $path = Join-Path $Directory $ManagerStateName
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
    try {
        $state = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    } catch {
        throw 'The saved dsh-session-delete installation target is unreadable. Re-run setup and choose DSH again.'
    }
    if ($state.schemaVersion -ne 2 -or $state.mode -notin @('portable', 'global') -or
        [string] $state.profile -notmatch '^[A-Za-z0-9._-]+$' -or
        $state.pathOwned -isnot [bool] -or $state.originalDependencyExists -isnot [bool] -or
        ($state.originalDependencyExists -and -not [string] $state.originalDependencySpec) -or
        -not [string] $state.managedDependencySpec) {
        throw 'The saved dsh-session-delete installation state is invalid. Re-run setup and choose DSH again.'
    }
    if ($state.mode -eq 'portable' -and -not [string] $state.portableRoot) {
        throw 'The saved DSH-Portable target is missing. Re-run setup and choose DSH again.'
    }
    if ($state.mode -eq 'global' -and
        (($state.PSObject.Properties['globalDsh'] -and -not [string] $state.globalDsh) -or
         ($state.PSObject.Properties['globalNode'] -and -not [string] $state.globalNode) -or
         -not [string] $state.globalDshHome)) {
        throw 'The saved global DSH target is invalid. Re-run setup and choose DSH again.'
    }
    return $state
}

function Write-ManagerState {
    param(
        [Parameter(Mandatory = $true)][string] $Directory,
        [Parameter(Mandatory = $true)] $Target,
        [Parameter(Mandatory = $true)][string] $SelectedProfile,
        [Parameter(Mandatory = $true)][bool] $PathOwned,
        [Parameter(Mandatory = $true)][bool] $OriginalDependencyExists,
        [AllowNull()][string] $OriginalDependencySpec
    )

    $path = Join-Path $Directory $ManagerStateName
    $staged = Join-Path $Directory ('.install-state-' + [guid]::NewGuid().ToString('N') + '.json')
    $state = [ordered]@{
        schemaVersion = 2
        mode = $Target.Mode
        portableRoot = if ($Target.Mode -eq 'portable') { $Target.Layout.Root } else { $null }
        globalDsh = if ($Target.Mode -eq 'global') { Resolve-FullPath $Target.Executable } else { $null }
        globalNode = if ($Target.Mode -eq 'global') { Resolve-FullPath $Target.Node } else { $null }
        globalDshHome = if ($Target.Mode -eq 'global') { Resolve-FullPath $Target.DshHome } else { $null }
        profile = $SelectedProfile
        pathOwned = $PathOwned
        originalDependencyExists = $OriginalDependencyExists
        originalDependencySpec = if ($OriginalDependencyExists) { $OriginalDependencySpec } else { $null }
        managedDependencySpec = $PackageUrl
    } | ConvertTo-Json -Compress
    try {
        [System.IO.File]::WriteAllText($staged, $state, $Utf8NoBom)
        Move-Item -LiteralPath $staged -Destination $path -Force
    } finally {
        if (Test-Path -LiteralPath $staged) {
            Remove-Item -LiteralPath $staged -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-PortableLayout {
    param([Parameter(Mandatory = $true)][string] $Root)

    $resolvedRoot = Resolve-FullPath $Root
    $node = Join-Path $resolvedRoot 'runtime\node\node.exe'
    $dsh = Join-Path $resolvedRoot 'app\node_modules\@deepseek-ai\dsh\lib\bin.js'
    $portableCli = Join-Path $resolvedRoot 'dsh.exe'
    if (-not (Test-Path -LiteralPath $node -PathType Leaf) -or
        -not (Test-Path -LiteralPath $dsh -PathType Leaf)) {
        return $null
    }

    $stateRoot = $resolvedRoot
    $installedMode = Join-Path $resolvedRoot 'installed-mode.json'
    if (Test-Path -LiteralPath $installedMode -PathType Leaf) {
        $mode = Get-Content -LiteralPath $installedMode -Raw | ConvertFrom-Json
        if (-not $mode.stateRoot) { throw "Invalid installed-mode.json: stateRoot is missing." }
        $stateRoot = Resolve-FullPath ([string] $mode.stateRoot)
    }

    return [pscustomobject]@{
        Root = $resolvedRoot
        StateRoot = $stateRoot
        Node = $node
        Dsh = $dsh
        PortableCli = if (Test-Path -LiteralPath $portableCli -PathType Leaf) { $portableCli } else { $null }
        DshHome = Join-Path $stateRoot 'data\dsh-home'
    }
}

function Resolve-GlobalDshHome {
    if ($DshHome) { return Resolve-FullPath $DshHome }
    if ($env:DSH_HOME) { return Resolve-FullPath $env:DSH_HOME }
    if ($env:LOCALAPPDATA) {
        $official = Join-Path $env:LOCALAPPDATA 'DeepSeek-Herness\data\dsh-home'
        if (Test-Path -LiteralPath $official -PathType Container) { return Resolve-FullPath $official }
    }
    $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
    if (-not $userProfile) { throw 'The global DSH profile root could not be resolved.' }
    return Join-Path $userProfile '.dsh'
}

function New-PortableTarget {
    param([Parameter(Mandatory = $true)] $Layout)
    $usesPortableCli = $null -ne $Layout.PortableCli
    return [pscustomobject]@{
        Mode = 'portable'
        Layout = $Layout
        Executable = if ($usesPortableCli) { $Layout.PortableCli } else { $Layout.Node }
        Node = $Layout.Node
        UsesPortableCli = $usesPortableCli
    }
}

function Find-PortableFromCurrentDirectory {
    $directory = [System.IO.DirectoryInfo]::new((Get-Location).Path)
    while ($null -ne $directory) {
        $layout = Get-PortableLayout $directory.FullName
        if ($null -ne $layout) { return $layout }
        $directory = $directory.Parent
    }
    return $null
}

function Find-RunningPortables {
    try {
        $processes = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop
        foreach ($process in $processes) {
            $executable = [string] $process.ExecutablePath
            if (-not $executable) { continue }
            $nodeDirectory = Split-Path -Parent $executable
            $runtimeDirectory = Split-Path -Parent $nodeDirectory
            $root = Split-Path -Parent $runtimeDirectory
            $layout = Get-PortableLayout $root
            if ($null -eq $layout) { continue }
            if (-not [string]::Equals(
                (Resolve-FullPath $executable),
                $layout.Node,
                [System.StringComparison]::OrdinalIgnoreCase
            )) { continue }
            $commandLine = [string] $process.CommandLine
            if ($commandLine -match '(?i)@deepseek-ai[\\/]dsh[\\/]lib[\\/]bin\.js') {
                Write-Output $layout
            }
        }
    } catch {
        # Process discovery is only one optional location hint.
    }
    return $null
}

function Find-CommonPortables {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:LOCALAPPDATA) {
        $candidates.Add((Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek-Herness'))
    }
    if ($env:USERPROFILE) {
        $candidates.Add((Join-Path $env:USERPROFILE 'Downloads\DSH-Portable'))
        $candidates.Add((Join-Path $env:USERPROFILE 'Desktop\DSH-Portable'))
        foreach ($parent in @(
            (Join-Path $env:USERPROFILE 'Downloads'),
            (Join-Path $env:USERPROFILE 'Desktop')
        )) {
            if (Test-Path -LiteralPath $parent -PathType Container) {
                foreach ($directory in Get-ChildItem -LiteralPath $parent -Directory -ErrorAction SilentlyContinue) {
                    $candidates.Add($directory.FullName)
                }
            }
        }
    }

    foreach ($candidate in $candidates | Select-Object -Unique) {
        $layout = Get-PortableLayout $candidate
        if ($null -ne $layout) { Write-Output $layout }
    }
}

function Get-ManagerTarget {
    param(
        [AllowNull()][string] $PreferredMode,
        [AllowNull()] $SavedState
    )

    if ($PortableRoot -and ($DshExecutable -or $NodeExecutable)) {
        throw 'PortableRoot cannot be combined with DshExecutable or NodeExecutable.'
    }
    if (($DshExecutable -and -not $NodeExecutable) -or ($NodeExecutable -and -not $DshExecutable)) {
        throw 'DshExecutable and NodeExecutable must be provided together.'
    }
    if ($DshExecutable -and $NodeExecutable) {
        $resolvedDsh = Resolve-FullPath $DshExecutable
        $resolvedNode = Resolve-FullPath $NodeExecutable
        if (-not (Test-Path -LiteralPath $resolvedDsh -PathType Leaf) -or
            -not (Test-Path -LiteralPath $resolvedNode -PathType Leaf)) {
            throw 'The explicitly selected global DSH target is no longer available.'
        }
        return [pscustomobject]@{
            Mode = 'global'; Layout = $null; Executable = $resolvedDsh; Node = $resolvedNode
            DshHome = (Resolve-GlobalDshHome); UsesPortableCli = $false
        }
    }

    if ($PortableRoot) {
        $layout = Get-PortableLayout $PortableRoot
        if ($null -eq $layout) {
            throw "The selected DSH-Portable folder is incomplete: $PortableRoot"
        }
        return New-PortableTarget $layout
    }

    if ($PreferredMode -eq 'global') {
        $savedDshPath = if ($null -ne $SavedState -and $SavedState.PSObject.Properties['globalDsh']) {
            [string] $SavedState.globalDsh
        } else { $null }
        $savedNodePath = if ($null -ne $SavedState -and $SavedState.PSObject.Properties['globalNode']) {
            [string] $SavedState.globalNode
        } else { $null }
        if ($savedDshPath -and $savedNodePath) {
            if (-not (Test-Path -LiteralPath $savedDshPath -PathType Leaf) -or
                -not (Test-Path -LiteralPath $savedNodePath -PathType Leaf)) {
                throw 'The saved global DSH target is no longer available. Re-run setup and choose DSH again.'
            }
            return [pscustomobject]@{
                Mode = 'global'
                Layout = $null
                Executable = Resolve-FullPath $savedDshPath
                Node = Resolve-FullPath $savedNodePath
                DshHome = Resolve-FullPath ([string] $SavedState.globalDshHome)
                UsesPortableCli = $false
            }
        }
        $savedGlobalDsh = Get-Command dsh -ErrorAction SilentlyContinue
        $savedGlobalNode = Get-Command node -ErrorAction SilentlyContinue
        if ($null -eq $savedGlobalDsh -or $null -eq $savedGlobalNode) {
            throw 'The saved global DSH target is no longer available on PATH. Re-run setup and choose DSH again.'
        }
        return [pscustomobject]@{
            Mode = 'global'
            Layout = $null
            Executable = $savedGlobalDsh.Source
            Node = $savedGlobalNode.Source
            DshHome = Resolve-GlobalDshHome
            UsesPortableCli = $false
        }
    }

    $layout = Find-PortableFromCurrentDirectory
    if ($null -ne $layout) {
        return New-PortableTarget $layout
    }

    $runningLayouts = @(Find-RunningPortables | Sort-Object -Property Root -Unique)
    if ($runningLayouts.Count -gt 1) {
        $paths = ($runningLayouts | ForEach-Object { "- $($_.Root)" }) -join [Environment]::NewLine
        throw "More than one running DSH-Portable was found. Re-run with -PortableRoot:`n$paths"
    }
    if ($runningLayouts.Count -eq 1) {
        $layout = $runningLayouts[0]
        return New-PortableTarget $layout
    }

    $globalDsh = Get-Command dsh -ErrorAction SilentlyContinue
    $commonLayouts = @(Find-CommonPortables | Sort-Object -Property Root -Unique)
    if ($commonLayouts.Count -gt 1) {
        $paths = ($commonLayouts | ForEach-Object { "- $($_.Root)" }) -join [Environment]::NewLine
        throw "More than one DSH-Portable folder was found. Re-run with -PortableRoot:`n$paths"
    }
    if ($null -ne $globalDsh -and $commonLayouts.Count -eq 1) {
        throw "Both a global dsh command and DSH-Portable were found. Run from the intended portable folder, or pass -PortableRoot '$($commonLayouts[0].Root)'."
    }
    if ($commonLayouts.Count -eq 1) {
        $layout = $commonLayouts[0]
        return New-PortableTarget $layout
    }
    if ($null -ne $globalDsh) {
        $globalNode = Get-Command node -ErrorAction SilentlyContinue
        if ($null -eq $globalNode) { throw 'The dsh command exists, but Node.js is not available on PATH.' }
        return [pscustomobject]@{ Mode = 'global'; Layout = $null; Executable = $globalDsh.Source; Node = $globalNode.Source; DshHome = (Resolve-GlobalDshHome); UsesPortableCli = $false }
    }

    throw @'
DeepSeek Harness was not found.

If you use DSH-Portable, start it once or run this command from inside its
folder. You can also pass -PortableRoot "C:\path\to\DSH-Portable".
'@
}

function Get-PnpmDirectory {
    param([Parameter(Mandatory = $true)] $Target)
    if ($Target.UsesPortableCli) { return $null }
    if ($Target.Mode -eq 'portable') {
        return Join-Path $Target.Layout.StateRoot "data\runtime\dsh-session-delete-tools\pnpm-$PnpmVersion"
    }
    if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required to cache the plugin manager.' }
    return Join-Path $env:LOCALAPPDATA "dsh-session-delete\tools\pnpm-$PnpmVersion"
}

function Get-PnpmStore {
    param([Parameter(Mandatory = $true)] $Target)
    if ($Target.Mode -eq 'portable') {
        return Join-Path $Target.Layout.StateRoot 'data\pnpm-store'
    }
    return $null
}

function Test-PnpmDirectory {
    param(
        [Parameter(Mandatory = $true)][string] $Directory,
        [Parameter(Mandatory = $true)][string] $Node
    )
    $entry = Join-Path $Directory 'package\bin\pnpm.cjs'
    if (-not (Test-Path -LiteralPath $entry -PathType Leaf)) { return $false }
    try {
        $reported = (& $Node $entry '--version' 2>$null | Select-Object -First 1)
        return ([string] $reported).Trim() -eq $PnpmVersion
    } catch {
        return $false
    }
}

function Install-PnpmTool {
    param(
        [Parameter(Mandatory = $true)][string] $Directory,
        [Parameter(Mandatory = $true)][string] $Node
    )

    if (Test-PnpmDirectory -Directory $Directory -Node $Node) { return }

    $parent = Split-Path -Parent $Directory
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
    $stage = Join-Path $parent ('.pnpm-' + [guid]::NewGuid().ToString('N'))
    $archive = Join-Path $stage 'pnpm.tgz'
    New-Item -ItemType Directory -Path $stage | Out-Null
    try {
        Write-Host "Preparing the bundled plugin manager (pnpm $PnpmVersion)..."
        Invoke-WebRequest -UseBasicParsing -Uri $PnpmUrl -OutFile $archive
        $actualHash = Get-FileDigest -Algorithm SHA512 -Path $archive
        if ($actualHash -ne $PnpmSha512) {
            throw "pnpm download checksum mismatch. Expected $PnpmSha512, received $actualHash."
        }
        $tar = Get-Command tar.exe -ErrorAction SilentlyContinue
        if ($null -eq $tar) { throw 'Windows tar.exe is required to unpack the verified pnpm package.' }
        & $tar.Source '-xzf' $archive '-C' $stage
        if ($LASTEXITCODE -ne 0) { throw "tar.exe failed with exit code $LASTEXITCODE." }
        Remove-Item -LiteralPath $archive -Force
        if (-not (Test-PnpmDirectory -Directory $stage -Node $Node)) {
            throw "The extracted pnpm package did not report version $PnpmVersion."
        }
        $shim = "@echo off`r`n`"%DSH_SESSION_DELETE_NODE%`" `"%~dp0package\bin\pnpm.cjs`" %*`r`n"
        [System.IO.File]::WriteAllText((Join-Path $stage 'pnpm.cmd'), $shim, [System.Text.Encoding]::ASCII)
        if (Test-Path -LiteralPath $Directory) {
            Remove-Item -LiteralPath $Directory -Recurse -Force
        }
        Move-Item -LiteralPath $stage -Destination $Directory
    } finally {
        if (Test-Path -LiteralPath $stage) {
            Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Get-ProfilePackageJsonPath {
    param([Parameter(Mandatory = $true)] $Target)

    $dshHome = if ($Target.Mode -eq 'portable') {
        $Target.Layout.DshHome
    } elseif ($Target.DshHome) {
        Resolve-FullPath $Target.DshHome
    } else {
        $userProfile = [Environment]::GetFolderPath([Environment+SpecialFolder]::UserProfile)
        if (-not $userProfile) { throw 'The current user profile folder could not be resolved.' }
        Join-Path $userProfile '.dsh'
    }
    return Join-Path $dshHome "profiles\$Profile\package.json"
}

function Test-DirectWorkspaceDependency {
    param(
        [Parameter(Mandatory = $true)] $Target,
        [Parameter(Mandatory = $true)][string] $Name
    )
    $path = Get-ProfilePackageJsonPath -Target $Target
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $false }
    $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    $dependencies = $manifest.PSObject.Properties['dependencies']
    return $null -ne $dependencies -and $null -ne $dependencies.Value -and
        $null -ne $dependencies.Value.PSObject.Properties[$Name]
}

function Assert-InstalledAliasPackage {
    param([Parameter(Mandatory = $true)] $Target)
    $profileDirectory = Split-Path -Parent (Get-ProfilePackageJsonPath -Target $Target)
    $manifestPath = Join-Path $profileDirectory 'node_modules\@deepseek-ai\dsh-client-ui-workspace\package.json'
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw 'The installed workspace replacement package was not linked into the selected profile.'
    }
    $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ([string] $manifest.name -ne 'dsh-session-delete' -or [string] $manifest.version -ne $PackageVersion) {
        throw "The linked workspace replacement has unexpected metadata: $([string] $manifest.name)@$([string] $manifest.version)."
    }
}

function Read-WorkspaceDependency {
    param([Parameter(Mandatory = $true)] $Target)

    $path = Get-ProfilePackageJsonPath -Target $Target
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
        return [pscustomobject]@{ Exists = $false; Spec = $null; Path = $path }
    }
    try {
        $manifest = Get-Content -LiteralPath $path -Raw | ConvertFrom-Json
    } catch {
        throw "The selected profile package.json is unreadable: $path"
    }
    $dependencies = $manifest.PSObject.Properties['dependencies']
    if ($null -eq $dependencies -or $null -eq $dependencies.Value) {
        return [pscustomobject]@{ Exists = $false; Spec = $null; Path = $path }
    }
    $dependency = $dependencies.Value.PSObject.Properties[$PackageName]
    if ($null -eq $dependency -or -not [string] $dependency.Value) {
        return [pscustomobject]@{ Exists = $false; Spec = $null; Path = $path }
    }
    return [pscustomobject]@{ Exists = $true; Spec = [string] $dependency.Value; Path = $path }
}

function Get-RestoreArguments {
    param(
        [Parameter(Mandatory = $true)][bool] $OriginalExists,
        [AllowNull()][string] $OriginalSpec,
        [AllowNull()][string] $Store
    )

    $arguments = if ($OriginalExists) {
        @('plugin', '--profile', $Profile, 'add', "$PackageName@$OriginalSpec")
    } else {
        @('plugin', '--profile', $Profile, 'remove', $PackageName)
    }
    if ($Store) { $arguments += @('--store-dir', $Store) }
    $arguments += @('--loglevel', 'error')
    return $arguments
}

function Assert-WorkspaceDependency {
    param(
        [Parameter(Mandatory = $true)] $Target,
        [Parameter(Mandatory = $true)][bool] $ExpectedExists,
        [AllowNull()][string] $ExpectedSpec
    )

    $current = Read-WorkspaceDependency -Target $Target
    if ([bool] $current.Exists -ne $ExpectedExists) {
        throw "The workspace dependency state did not match the expected result in $($current.Path)."
    }
    if ($ExpectedExists -and -not [string]::Equals(
        [string] $current.Spec,
        [string] $ExpectedSpec,
        [System.StringComparison]::Ordinal
    )) {
        throw "The workspace dependency spec did not match the expected result in $($current.Path)."
    }
}

function Get-ActionArguments {
    param(
        [Parameter(Mandatory = $true)][string] $SelectedAction,
        [AllowNull()][string] $Store,
        [string] $SelectedPackage = $PackageName
    )
    if ($SelectedAction -eq 'Uninstall') {
        $arguments = @('plugin', '--profile', $Profile, 'remove', $SelectedPackage)
    } else {
        $arguments = @('plugin', '--profile', $Profile, 'add', $PackageSpec)
    }
    if ($Store) { $arguments += @('--store-dir', $Store) }
    $arguments += @('--loglevel', 'error')
    return $arguments
}

function Invoke-DshCommand {
    param(
        [Parameter(Mandatory = $true)] $Target,
        [Parameter(Mandatory = $true)][string[]] $Arguments,
        [switch] $Capture
    )
    $allArguments = if ($Target.Mode -eq 'portable' -and -not $Target.UsesPortableCli) {
        @($Target.Layout.Dsh) + $Arguments
    } else {
        $Arguments
    }
    if ($Capture) {
        $output = & $Target.Executable @allArguments 2>&1
        $exitCode = $LASTEXITCODE
        if ($exitCode -ne 0) { throw "dsh failed with exit code $exitCode.`n$($output -join [Environment]::NewLine)" }
        return ($output -join [Environment]::NewLine)
    }
    & $Target.Executable @allArguments
    if ($LASTEXITCODE -ne 0) { throw "dsh failed with exit code $LASTEXITCODE." }
}

$managerCommandRoot = Get-ManagerCommandRoot
$managerState = Read-ManagerState -Directory $managerCommandRoot
if ($null -ne $managerState) {
    if ($PSBoundParameters.ContainsKey('PortableRoot')) {
        if ($managerState.mode -ne 'portable' -or
            -not (Test-SamePath -Left $PortableRoot -Right ([string] $managerState.portableRoot))) {
            throw 'The selected DSH target differs from the target owned by this manager. Uninstall from the recorded target before selecting another installation.'
        }
    }
    if ($PSBoundParameters.ContainsKey('DshExecutable') -or $PSBoundParameters.ContainsKey('NodeExecutable') -or
        $PSBoundParameters.ContainsKey('DshHome')) {
        $dshMismatch = $DshExecutable -and -not (Test-SamePath -Left $DshExecutable -Right ([string] $managerState.globalDsh))
        $nodeMismatch = $NodeExecutable -and -not (Test-SamePath -Left $NodeExecutable -Right ([string] $managerState.globalNode))
        $homeMismatch = $DshHome -and -not (Test-SamePath -Left $DshHome -Right ([string] $managerState.globalDshHome))
        if ($managerState.mode -ne 'global' -or
            $dshMismatch -or $nodeMismatch -or $homeMismatch) {
            throw 'The selected DSH target differs from the target owned by this manager. Uninstall from the recorded target before selecting another installation.'
        }
    }
}
if ($Managed -and $null -ne $managerState) {
    $explicitPortableRoot = $PSBoundParameters.ContainsKey('PortableRoot')
    $sameSavedPortable = $explicitPortableRoot -and $managerState.mode -eq 'portable' -and
        (Test-SamePath -Left $PortableRoot -Right ([string] $managerState.portableRoot))
    if (-not $PSBoundParameters.ContainsKey('Profile') -and
        (-not $explicitPortableRoot -or $sameSavedPortable)) {
        $Profile = [string] $managerState.profile
    }
    if (-not $PSBoundParameters.ContainsKey('PortableRoot') -and $managerState.mode -eq 'portable') {
        $PortableRoot = [string] $managerState.portableRoot
    }
}
$legacyManagedPathOwned = $false
if ($Managed -and $null -eq $managerState -and
    (Test-Path -LiteralPath (Join-Path $managerCommandRoot $ManagerScriptName) -PathType Leaf)) {
    $currentUserPath = [Environment]::GetEnvironmentVariable('Path', 'User')
    $legacyManagedPathOwned = [string]::Equals(
        [string] (Add-UserPathEntry -UserPath $currentUserPath -Directory $managerCommandRoot),
        [string] $currentUserPath,
        [System.StringComparison]::Ordinal
    )
}
if ($Managed -and $Action -eq 'Update' -and -not $SkipSelfUpdate -and -not $DryRun) {
    Invoke-LatestManager -InstalledCommandRoot $managerCommandRoot
    exit 0
}

$preferredMode = if ($Managed -and $null -ne $managerState) { [string] $managerState.mode } else { $null }
$target = Get-ManagerTarget -PreferredMode $preferredMode -SavedState $managerState
$managerCommand = Join-Path $managerCommandRoot 'dsh-session-delete.cmd'
$pnpmDirectory = Get-PnpmDirectory $target
$pnpmStore = Get-PnpmStore $target
$actionArguments = Get-ActionArguments -SelectedAction $Action -Store $pnpmStore
$arguments = if ($target.Mode -eq 'portable' -and -not $target.UsesPortableCli) {
    @($target.Layout.Dsh) + $actionArguments
} else {
    $actionArguments
}

if ($DryRun) {
    [ordered]@{
        mode = $target.Mode
        action = $Action
        executable = $target.Executable
        arguments = $arguments
        dshHome = if ($target.Mode -eq 'portable') { $target.Layout.DshHome } else { $null }
        pnpmVersion = $PnpmVersion
        pnpmDirectory = $pnpmDirectory
        pnpmStore = $pnpmStore
        packageName = $PackageName
        legacyPackageName = $LegacyPackageName
        packageVersion = $PackageVersion
        packageSpec = $PackageSpec
        managerCommand = $managerCommand
        installsManagerCommand = $Action -ne 'Uninstall'
        modifiesUserPath = ($Action -ne 'Uninstall') -and (-not $NoModifyPath)
        removesProfile = $false
    } | ConvertTo-Json -Depth 4 -Compress
    exit 0
}

$oldPath = $env:PATH
$oldDshHome = $env:DSH_HOME
$oldDshPortable = $env:DSH_PORTABLE
$oldTelemetry = $env:DSH_TELEMETRY_MODE
$oldManagerNode = $env:DSH_SESSION_DELETE_NODE
$oldPnpmStore = $env:npm_config_store_dir
$oldPnpmNotifier = $env:npm_config_update_notifier
try {
    if (-not $target.UsesPortableCli) {
        Install-PnpmTool -Directory $pnpmDirectory -Node $target.Node
    }
    $env:DSH_SESSION_DELETE_NODE = $target.Node
    if (-not $target.UsesPortableCli) {
        $env:PATH = $pnpmDirectory + [System.IO.Path]::PathSeparator + (Split-Path -Parent $target.Node) + [System.IO.Path]::PathSeparator + $oldPath
    }
    $env:npm_config_update_notifier = 'false'
    if ($target.Mode -eq 'portable') {
        New-Item -ItemType Directory -Force -Path $target.Layout.DshHome | Out-Null
        $env:DSH_HOME = $target.Layout.DshHome
        $env:DSH_PORTABLE = '1'
        $env:DSH_TELEMETRY_MODE = 'DISABLED'
        $env:npm_config_store_dir = $pnpmStore
    } else {
        New-Item -ItemType Directory -Force -Path $target.DshHome | Out-Null
        $env:DSH_HOME = $target.DshHome
    }

    # Capture the direct dependency before invoking `plugin list`: DSH may
    # migrate or reconcile profile files during its first plugin command.
    $dependencyBefore = Read-WorkspaceDependency -Target $target

    if (($Action -eq 'Update' -or $Action -eq 'Uninstall') -and
        $null -ne $managerState -and
        ((-not [bool] $dependencyBefore.Exists) -or
            -not [string]::Equals([string] $dependencyBefore.Spec, [string] $managerState.managedDependencySpec, [System.StringComparison]::OrdinalIgnoreCase))) {
        throw 'The DSH workspace dependency changed after this manager installed it. Nothing was modified; reinstall explicitly if you want this plugin to take ownership again.'
    }
    if ($Action -eq 'Uninstall' -and $null -eq $managerState -and
        ((-not [bool] $dependencyBefore.Exists) -or
            -not [string]::Equals([string] $dependencyBefore.Spec, $PackageUrl, [System.StringComparison]::OrdinalIgnoreCase))) {
        throw 'This manager does not own the current DSH workspace dependency. Nothing was modified.'
    }
    $hadLegacyPackage = Test-DirectWorkspaceDependency -Target $target -Name $LegacyPackageName

    $originalDependencyExists = if ($null -ne $managerState) {
        [bool] $managerState.originalDependencyExists
    } else {
        [bool] $dependencyBefore.Exists -and
            ([string] $dependencyBefore.Spec -notmatch '(?i)github\.com/WSL043/dsh-session-delete/releases/download/v')
    }
    $originalDependencySpec = if ($null -ne $managerState -and $managerState.originalDependencyExists) {
        [string] $managerState.originalDependencySpec
    } elseif ($originalDependencyExists) {
        [string] $dependencyBefore.Spec
    } else {
        $null
    }

    if ($Action -eq 'Uninstall') {
        Invoke-DshCommand -Target $target -Arguments (
            Get-RestoreArguments -OriginalExists $originalDependencyExists `
                -OriginalSpec $originalDependencySpec -Store $pnpmStore
        )
        if ($hadLegacyPackage) {
            Invoke-DshCommand -Target $target -Arguments (
                Get-ActionArguments -SelectedAction 'Uninstall' -Store $pnpmStore -SelectedPackage $LegacyPackageName
            )
        }
        Assert-WorkspaceDependency -Target $target -ExpectedExists $originalDependencyExists `
            -ExpectedSpec $originalDependencySpec

        $removePath = (-not $NoModifyPath) -and (
            ($null -ne $managerState -and [bool] $managerState.pathOwned) -or
            ($null -eq $managerState -and $legacyManagedPathOwned)
        )
        Remove-ManagerCommand -Directory $managerCommandRoot -RemovePath $removePath
        $result = if ($originalDependencyExists) {
            'Uninstalled. The original DSH workspace dependency was restored.'
        } else {
            'Uninstalled. The plugin dependency was removed; sessions and the rest of the profile were kept.'
        }
        Write-Host $result
    } else {
        try {
            Invoke-DshCommand -Target $target -Arguments $actionArguments
            if ($hadLegacyPackage) {
                Invoke-DshCommand -Target $target -Arguments (
                    Get-ActionArguments -SelectedAction 'Uninstall' -Store $pnpmStore -SelectedPackage $LegacyPackageName
                )
            }
            Assert-WorkspaceDependency -Target $target -ExpectedExists $true -ExpectedSpec $PackageUrl

            Assert-InstalledAliasPackage -Target $target
            if (Test-DirectWorkspaceDependency -Target $target -Name $LegacyPackageName) {
                throw 'A bare dsh-session-delete package is still present after migration.'
            }
        } catch {
            $operationError = $_
            try {
                Invoke-DshCommand -Target $target -Arguments (
                    Get-RestoreArguments -OriginalExists ([bool] $dependencyBefore.Exists) `
                        -OriginalSpec ([string] $dependencyBefore.Spec) -Store $pnpmStore
                )
                Assert-WorkspaceDependency -Target $target -ExpectedExists ([bool] $dependencyBefore.Exists) `
                    -ExpectedSpec ([string] $dependencyBefore.Spec)
            } catch {
                throw "Installation failed and rollback could not be confirmed. Original error: $($operationError.Exception.Message) Rollback error: $($_.Exception.Message)"
            }
            throw $operationError
        }

        try {
            $addedPath = Install-ManagerCommand -Directory $managerCommandRoot
            $pathOwned = ($null -ne $managerState -and [bool] $managerState.pathOwned) -or
                $legacyManagedPathOwned -or [bool] $addedPath
            Write-ManagerState -Directory $managerCommandRoot -Target $target -SelectedProfile $Profile `
                -PathOwned $pathOwned -OriginalDependencyExists $originalDependencyExists `
                -OriginalDependencySpec $originalDependencySpec
        } catch {
            $managerError = $_
            try {
                Invoke-DshCommand -Target $target -Arguments (
                    Get-RestoreArguments -OriginalExists ([bool] $dependencyBefore.Exists) `
                        -OriginalSpec ([string] $dependencyBefore.Spec) -Store $pnpmStore
                )
                Assert-WorkspaceDependency -Target $target -ExpectedExists ([bool] $dependencyBefore.Exists) `
                    -ExpectedSpec ([string] $dependencyBefore.Spec)
            } catch {
                throw "Manager installation failed and dependency rollback could not be confirmed. Manager error: $($managerError.Exception.Message) Rollback error: $($_.Exception.Message)"
            }
            throw $managerError
        }
        $verb = if ($Action -eq 'Update') { 'Updated.' } else { 'Installed.' }
        Write-Host "$verb Restart DSH manually to load the change if it is currently running."
    }
} finally {
    $env:PATH = $oldPath
    $env:DSH_HOME = $oldDshHome
    $env:DSH_PORTABLE = $oldDshPortable
    $env:DSH_TELEMETRY_MODE = $oldTelemetry
    $env:DSH_SESSION_DELETE_NODE = $oldManagerNode
    $env:npm_config_store_dir = $oldPnpmStore
    $env:npm_config_update_notifier = $oldPnpmNotifier
}
