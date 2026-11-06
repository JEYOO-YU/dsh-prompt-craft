# 把本仓库推到 GitHub（首次发布和之后更新都用它）。
#
# 前提：你已经在 github.com 上手动建了一个**空仓库**（不勾 README / .gitignore / license），
#       名字建议 dsh-prompt-craft。建库这一步只能你来做，脚本不碰你的账号和凭据。
#
# 用法（在 dsh-prompt-craft 目录里）：
#   .\scripts\publish.cmd                       # 双击或命令行都行，已处理执行策略
#   .\scripts\publish.cmd -Repo https://github.com/JEYOO-YU/别的名字.git
#
# 第一次 push 会弹出 Git Credential Manager 的登录窗口（浏览器里点一下授权），
# 凭据存进 Windows 凭据管理器，以后不用再输。

param(
  [string]$Repo = 'https://github.com/JEYOO-YU/dsh-prompt-craft.git',
  [string]$Branch = 'main',
  [string]$Message = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent $PSScriptRoot
Push-Location $root

try {
  # DSH 自带 PortableGit，但通常不在 PATH 里，所以先找它。
  $git = 'git'
  $candidates = @("$env:USERPROFILE\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe")
  $versionsDir = "$env:USERPROFILE\.workbuddy\binaries\PortableGit\versions"
  if (Test-Path $versionsDir) {
    $candidates += Get-ChildItem $versionsDir -Directory |
      ForEach-Object { Join-Path $_.FullName 'cmd\git.exe' }
  }
  foreach ($candidate in $candidates) {
    if (Test-Path $candidate) { $git = $candidate; break }
  }
  Write-Host "git: $git"

  if (-not (Test-Path (Join-Path $root '.git'))) {
    Write-Host '初始化仓库 ...'
    & $git init -b $Branch | Out-Null
  }

  # 有未提交改动就先提交，否则 push 出去的还是旧内容。
  $dirty = & $git status --porcelain
  if ($dirty) {
    $msg = if ($Message) { $Message } else { 'update dsh-prompt-craft' }
    Write-Host "提交改动：$msg"
    & $git add -A | Out-Null
    & $git commit -m $msg | Out-Null
    if ($LASTEXITCODE -ne 0) { throw '提交失败' }
  }

  $remotes = & $git remote
  if ($remotes -contains 'origin') {
    & $git remote set-url origin $Repo | Out-Null
  } else {
    & $git remote add origin $Repo | Out-Null
  }
  if ($LASTEXITCODE -ne 0) { throw "设置 remote 失败：$Repo" }

  Write-Host "推送到 $Repo ($Branch) ..."
  & $git push -u origin $Branch
  if ($LASTEXITCODE -ne 0) {
    throw "push 失败（退出码 $LASTEXITCODE）：检查仓库是否为空、地址是否正确、弹窗里是否完成了登录。"
  }

  Write-Host ''
  Write-Host '完成。其它电脑上这样装：'
  Write-Host '  dsh plugin --profile desktop add github:JEYOO-YU/dsh-prompt-craft'
  Write-Host ('  固定到这个提交：github:JEYOO-YU/dsh-prompt-craft#' + (& $git rev-parse --short HEAD).Trim())
}
finally {
  Pop-Location
}
