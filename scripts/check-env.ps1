# 协同版环境自检 —— 只检查，不改你的环境
#
#   powershell -ExecutionPolicy Bypass -File scripts/check-env.ps1
#
# 故意不替你装插件、不改 profile：那是要你确认的动作。
# 这个脚本只回答一个问题：**现在缺什么，才能装上协同版。**

$ErrorActionPreference = 'Continue'

function Pass($msg) { Write-Host "  [OK]   $msg" -ForegroundColor Green }
function Fail($msg) { Write-Host "  [缺]   $msg" -ForegroundColor Red }
function Warn($msg) { Write-Host "  [注意] $msg" -ForegroundColor Yellow }
function Info($msg) { Write-Host "  $msg" -ForegroundColor DarkGray }

Write-Host "`n=== 1. 运行环境 ===" -ForegroundColor Cyan

# Node（插件跑在 DSH 的 node 里，这里只确认开发/安装链可用）
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nv = (& node --version) -replace 'v', ''
    $major = [int]($nv.Split('.')[0])
    if ($major -ge 24) { Pass "node $nv" } else { Warn "node $nv（DSH 要求 >=24，插件本身不强制）" }
} else {
    Fail "没有 node —— 安装插件链需要"
}

# Python（平台要用）
$py = Get-Command python -ErrorAction SilentlyContinue
if ($py) {
    $pv = (& python -c "import sys;print('.'.join(map(str,sys.version_info[:3])))") 2>$null
    if ($pv) {
        $mn = [int]($pv.Split('.')[1])
        if ($mn -ge 11) { Pass "python $pv ($($py.Source))" } else { Fail "python $pv 太旧（需要 3.11+）" }
    }
} else {
    Fail "没有 python —— 学习平台跑不起来"
}

# DSH
$dsh = Get-Command dsh -ErrorAction SilentlyContinue
if ($dsh) { Pass "dsh CLI：$($dsh.Source)" } else { Warn "dsh CLI 不在 PATH（桌面版通常如此；用 GUI 插件页安装即可）" }

Write-Host "`n=== 2. 协同版三件套 ===" -ForegroundColor Cyan

$pluginDir = Join-Path $PSScriptRoot '..\plugins\studyhub'
if (Test-Path (Join-Path $pluginDir 'package.json')) {
    Pass "① studyhub 插件：$((Resolve-Path $pluginDir).Path)"
} else {
    Fail "① studyhub 插件不在预期位置（应在 plugins/studyhub）"
}

$profileRoot = Join-Path $env:USERPROFILE '.dsh\profiles'
$learnInstalled = $false
if (Test-Path $profileRoot) {
    $learnInstalled = [bool](Get-ChildItem $profileRoot -Directory |
        ForEach-Object { Join-Path $_.FullName 'node_modules\dsh-learnharness' } |
        Where-Object { Test-Path $_ })
}
if ($learnInstalled) {
    Pass "② dsh-learnharness 已安装（教学法）"
} else {
    Warn "② dsh-learnharness 未安装 —— 装它才有'教'的能力：plugin_manager install_bundle target: dsh-learnharness"
}

$foundPlatform = $null
foreach ($candidate in @('C:\StudyAI\_webapp', (Join-Path $env:USERPROFILE 'StudyAI\_webapp'))) {
    if (Test-Path (Join-Path $candidate 'server.py')) { $foundPlatform = $candidate; break }
}
if ($foundPlatform) {
    Pass "③ 学习平台：$foundPlatform"
    try {
        $ping = Invoke-WebRequest 'http://127.0.0.1:8777/api/ping' -UseBasicParsing -TimeoutSec 3
        Pass "   平台正在运行：$($ping.Content.Trim())"
    } catch {
        Warn "   平台没在跑（插件会自动拉起；也可手动 python server.py --ide）"
    }
} else {
    Fail "③ 找不到学习平台（_webapp\server.py）—— 没有讲义，材料工具会如实报'不在线'"
}

Write-Host "`n=== 3. 语言包依赖（可选）===" -ForegroundColor Cyan
foreach ($tool in @('node', 'g++', 'gcc', 'rustc')) {
    if (Get-Command $tool -ErrorAction SilentlyContinue) { Pass "$tool" } else { Info "$tool 未安装（对应语言包会显示'缺依赖'，不影响其他）" }
}

Write-Host "`n=== 4. 下一步 ===" -ForegroundColor Cyan
if (-not $learnInstalled) {
    Info "1) 装教学法：plugin_manager install_bundle  target: dsh-learnharness"
}
Info "2) 装本插件：plugin_manager install_bundle  target: $((Resolve-Path $pluginDir).Path)"
Info "3) 改 platformDir 指向你的平台目录（见 docs/setup.md 第三节）"
Info "4) 重启 DSH"
Info "5) 新会话选「学习模式」，点左下角「讲义」"
Write-Host ""
