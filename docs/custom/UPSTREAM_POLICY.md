# 上游维护策略

## 已核验的关系

2026-10-31，`dev`、`custom/dev`、`origin/dev`、`origin/custom/dev`、本地缓存的 `upstream/dev` 均指向 `42443d83f9a536a3e1c501991ac8b6f635e69bc1`。`dev...custom/dev` 和 `custom/dev...upstream/dev` 的左右提交数均为 `0 0`。本轮未 fetch，不能据此断言远端实时没有新提交。

- `origin`：个人 Fork，允许的推送目标；本轮不推送。
- `upstream`：官方只读更新来源，已有本地 `remote.upstream.pushurl=DISABLED`。
- `dev`：个人 Fork 的干净官方基线。
- `custom/dev`：个人功能长期集成分支；Phase 0 文档最初在此准备。
- `feature/*`：后续每项功能使用独立分支，验收后才集成。当前没有开始功能开发，因此未创建功能分支。

工作开始时核验 `git status --short --branch`、`git branch -vv`、`git remote -v` 和 HEAD。现有结构满足 Phase 0；本轮未创建分支，也未改 Git 配置。`DISABLED` 是防误操作的本地配置，不是服务端权限控制；不得显式改写该地址来推送。

后续 Windows 实施已创建并切换到 `feature/windows-custom`，承接原先未提交的 Phase 0 文档。以上“不创建分支”描述仅对应历史 Phase 0。所有者随后授权本次单独提交、推送功能分支，不合并或更新干净的 dev 基线。

## 后续同步 upstream 的步骤（本轮未执行）

1. 保留当前未提交内容，记录自定义 HEAD、官方基线、锁文件、可用程序资源和数据格式版本。
2. `git fetch upstream` 仅更新远端引用，不覆盖工作树。先审阅提交、依赖和许可证差异。
3. 在专用升级分支合入官方更新；不 force reset、不删除个人提交。发生真实冲突时逐项核验，不照搬旧补丁。
4. 检查 store、IPC、数据库、ConfigService、阅读引擎接口、TTS 元数据/缓存、更新流程和打包配置。
5. 执行类型检查、单元测试和隔离数据回归；Windows 渲染资源和桌面打包在 GitHub 云端验证。当前不要求单独执行本地 Web 构建。
6. 提交兼容报告供所有者决定合并、提交和推送；没有授权不执行这些操作。

## 构建和发布边界

现有 `.github/workflows/release.yml` 是 `workflow_dispatch`，使用 Node 22，在 Windows、macOS、Linux runner 上安装依赖、类型检查并调用 Electron 构建 action。该 action 对 `v*` 标签启用 release；配置还引用官方产品名、仓库和签名信息。当前不能把它视为已隔离的 Custom 发布流水线。

未来应准备只构建和上传 CI artifact 的独立验证流程，明确禁止 publish，先只验证 Windows x64，保留 commit、锁文件、Electron 版本、架构、ABI 与构建日志。添加或触发工作流、上传产物和发布分别按当时授权执行。本轮只静态审计，不创建/触发云端任务。

## 更新覆盖风险

`updateDialog` → `checkDeveloperUpdate/checkStableUpdate` → 官方 API → Windows `update-win-app` IPC → 下载 `https://dl.koodoreader.com/v<version>/Koodo-Reader-<version>-<arch>.exe` → `will-quit` 启动安装程序。

`package.json` 仍使用官方 `appId`、`productName`、GitHub publish 目标和协议名。现有安装的 `resources/app-update.yml` 也指向官方仓库。更改 publish 配置不会自动切断上述手写 Windows 更新链；必须同时处理 UI、IPC 和安装身份。

设置中的禁用更新项不应当作 Custom 版本的可靠隔离措施：现有 UI 判断还受登录状态影响。本轮没有更改设置、更新器或安装资源，风险仍存在。

`assets/windows/installer.nsh` 的安装钩子会终止 `Koodo Reader.exe`，手动卸载路径含删除 `%APPDATA%\koodo-reader` 的选项。不得用安装/卸载流程做无保护的回归或回滚。

## Windows 实施后的更新与构建状态

上述风险描述保留为 Phase 0 审计证据。新源码已经更改 appId/productName/profile、清空 publish，Windows 目标收敛为 x64 zip；主进程拒绝 update-win-app，自动更新 UI 提前返回，关于页面提示使用自有构建。旧 NSIS include 由无删除/杀进程逻辑的 Custom include 替代。

新增 `.github/workflows/custom-windows.yml`：支持手动调用和 workflow_call，不随 push 自动运行，contents:read，Node 22.14.0；安装 JS 依赖时跳过脚本，在 runner 准备 Electron/native，执行类型、测试、Windows 渲染资源编译、隔离冒烟，再 `--publish never` 构建 zip 并上传 workflow artifact。没有创建 release、推送 tag 或访问官方发布仓库的步骤。本轮未触发该工作流。

既有 `release.yml` 增加功能分支路由：从 Build/release 手动入口选 feature/* 或 custom/* 时调用上述流程，跳过原多平台任务；这避免为登记新工作流修改默认分支。具体操作见 [Windows 使用说明](WINDOWS_GUIDE.md)。

upstream 更新检查除了原有位置，还需覆盖 `src/custom/`、`src/utils/main/custom/`、Azure 插件元数据、TTS queue generation、database-command 的 CAS 分支、preload 白名单、profile 初始化时序、关于页及两个 workflow 的路由。不要用原多平台发布任务代替 Custom 验证流程。
