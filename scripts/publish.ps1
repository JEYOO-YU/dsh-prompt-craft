# 把本仓库推到 GitHub（首次发布和之后更新都用它）。
#
# 前提：github.com 上已经有仓库；空仓库或带初始 README 都可以——远程多了提交时
#       脚本会自动 fetch + rebase（同名文件以本地为准），然后重推一次。
#
# 用法（在 dsh-prompt-craft 目录里）：
#   .\scripts\publish.cmd                       # 双击或命令行都行，已处理执行策略
#   .\scripts\publish.cmd -Repo https://github.com/JEYOO-YU/别的名字.git
#
# 凭据：脚本显式使用 Git Credential Manager（跳过 PortableGit 首次运行的
#       credential-helper-selector 选择框，那个弹窗会挂住进程）。没登录过时
#       仍会弹出 GCM 的登录窗口，凭据存进 Windows 凭据管理器，以后不用再输。

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

  # PortableGit's system config installs `credential.helper = helper-selector` as a
  # first-run GUI chooser; when it cannot show the dialog it blocks the push forever.
  # Clearing the list and pinning GCM makes every network call non-interactive
  # (GCM itself still prompts for a browser login the first time).
  $auth = @('-c', 'credential.helper=', '-c', 'credential.helper=manager')

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
  & $git @auth push -u origin $Branch
  $code = $LASTEXITCODE

  if ($code -ne 0) {
    # 远程已有本地没有的提交（例如在网页上改过 README）时，先同步再推。
    Write-Host ''
    Write-Host 'push 未成功，检查是否远程已存在提交 ...'
    & $git @auth fetch origin $Branch
    if ($LASTEXITCODE -eq 0) {
      $behind = (& $git rev-list --count "HEAD..origin/$Branch" 2>$null)
      if ($behind -and [int]$behind -gt 0) {
        Write-Host ("远程有 {0} 个提交不在本地，rebase 到它之上（同名文件以本地为准）..." -f $behind)
        & $git @auth -c user.name='JEYOO-YU' -c user.email='JEYOO-YU@users.noreply.github.com' rebase -X theirs "origin/$Branch"
        if ($LASTEXITCODE -ne 0) {
          & $git rebase --abort 2>$null
          throw 'rebase 冲突且无法自动解决；请手动处理后再运行本脚本。'
        }
        Write-Host 'rebase 完成，重新推送 ...'
        & $git @auth push -u origin $Branch
        $code = $LASTEXITCODE
      }
    }
  }

  if ($code -ne 0) {
    throw @'
push 失败。按提示分辨原因：
  - Connection was aborted / Failed to connect / Recv failure  → 网络到 github.com 不通，换网络或开代理后重试
  - Authentication failed / 弹窗没完成登录                      → 打开「Windows 凭据管理器」删掉 git:https://github.com，再重试让登录窗口重新弹出
  - 仍提示 fetch first                                          → 远程有本地没有的提交，先 git pull --rebase 再重试
'@
  }

  Write-Host ''
  Write-Host '完成。其它电脑上这样装：'
  Write-Host '  dsh plugin --profile desktop add github:JEYOO-YU/dsh-prompt-craft'
  Write-Host ('  固定到这个提交：github:JEYOO-YU/dsh-prompt-craft#' + (& $git rev-parse --short HEAD).Trim())
}
finally {
  Pop-Location
}
