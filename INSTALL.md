# 装到另一台电脑

这个插件没有依赖、不需要 Node、不需要 pnpm、不需要构建：整包就是 5 个文件（`package.json`、`cordis.patch.yml`、`lib/index.js`、`lib/client.js`、`README.md`）。所以"搬家"只是把这几个文件放到目标机、再让 DSH 把它登记成 bundle 这一步。

**目标机前提**：DeepSeek Harness 版本满足 `>=0.1.1-rc.2 <0.3.0`（本机是 0.2.2.0）。版本不符时安装会被 `dsh.engines.dsh` 拦下。

---

## 方式一：拷 tgz（离线、最省事）

1. 把 `dist/dsh-prompt-craft-0.1.0.tgz` 拷到目标机任意目录，例如 `D:\plugins\dsh-prompt-craft-0.1.0.tgz`。
2. 在目标机的 DSH 会话里让 agent 装：**安装 bundle，目标就是那个 tgz 的绝对路径**（等价于 `plugin_manager install_bundle`，`target` 传 `D:\plugins\dsh-prompt-craft-0.1.0.tgz`）。
   命令行等价写法：`dsh plugin --profile <profile名> add D:\plugins\dsh-prompt-craft-0.1.0.tgz`
3. 刷新目标机的 DSH 网页，输入框右侧出现「✦ 锻造」。

本机已验证过这条路径：用 tgz 装上后接口返回 200，随后再换回目录安装，功能不变。

> profile 名本机是 `desktop`，别的机器可能不同；不确定就看 `C:\Users\<你>\.dsh\profiles\` 下的目录名，或直接问那台机器的 agent。

## 方式二：GitHub 仓库（推荐，多台机器共用一份）

仓库：<https://github.com/JEYOO-YU/dsh-prompt-craft>

1. 目标机安装（profile 名按实际改，本机是 `desktop`）：
   - 让 agent 装：`plugin_manager install_bundle`，`target` 传 `github:JEYOO-YU/dsh-prompt-craft`
   - 或命令行：`dsh plugin --profile desktop add github:JEYOO-YU/dsh-prompt-craft`
2. 想钉住某个提交（以后 push 不影响已装好的机器）：把 `#<commit>` 追加到 spec 后，例如 `github:JEYOO-YU/dsh-prompt-craft#a1b2c3d`。
3. 更新：本机改完 push，目标机 `remove` 再 `add` 一次即可。

> 走 GitHub 这条时，目标机的 pnpm 要用到 `git`。DSH 桌面版通常自带 PortableGit（本机在 `%USERPROFILE%\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe`），但可能不在 PATH 里；如果安装报 "git not found"，把它的 `cmd` 目录加进 PATH 再装一次。
> 私有仓库在目标机上还需要 git 凭据（PAT）；不想折腾就用公开仓库，或者退回方式一拷 tgz。

## 方式三：整目录拷贝（两台机器上都继续改代码时用）

把 `dsh-prompt-craft` 目录原样拷过去（可以不带 `dist/`、`smoke/`），让 agent 用 `install_bundle` 传**目录绝对路径**。此时 profile 里记的是 `link:`，**不要把那个目录删掉或改名**，否则插件失效；要移除先卸载。

## 方式四：发到 npm（最正规、可多机复用）

```powershell
npm publish            # 包名若被占用，可加 scope：@yourname/dsh-prompt-craft
```

目标机：`dsh plugin --profile <profile名> add @yourname/dsh-prompt-craft`，或让 agent 用 `install_bundle` 传包名。私有 registry 同样适用。

---

## 装完怎么确认

1. 输入框右侧有「✦ 锻造」按钮，原插件的「增强」还在它左边 → 两个插件共存成功。
2. 让 agent 查一下插槽：`conversation.input.right` 里应同时有 `prompt-enhance` 与 `prompt-craft` 两条 `active: true`。
3. 点一次按钮，上方出现结果条（`N → M 字 · 耗时 · 模型`）→ 说明 Host 路由与模型调用都正常。

## 卸载

- GUI：设置 → 插件 → `dsh-prompt-craft` 关闭或卸载。
- 命令行：`dsh plugin --profile <profile名> remove dsh-prompt-craft`。

卸载只影响本插件，`dsh-prompt-enhance` 与其它插件不受影响。

## 注意事项

- 模型走**那台机器自己的默认路由**（`agentDefaultModel`），不跟着文件走；目标机没配模型时点按钮会提示"当前没有可用的模型路由"。
- 不要把 `node_modules` 拷来拷去——本插件没有任何依赖。
- tgz 里只含运行必需文件；`smoke/` 自测脚本和 `dist/` 不在包内，做开发时才需要。
