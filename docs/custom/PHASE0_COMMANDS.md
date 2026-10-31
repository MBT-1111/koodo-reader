# Phase 0 命令与执行边界

日期：2026-10-31；除指定外工作目录均为 `D:\MyProjects\Web_Apps\koodo_reader`。以下记录实际命令与核心参数；分批执行了只读检索，未把建议步骤记为已执行。完整 stdout/stderr 路径见验收报告。

## 指令、仓库和环境（已执行）

```powershell
Get-Content -LiteralPath 'C:\Users\Binte\.codex\skills\karpathy-guidelines\SKILL.md'
Get-Content -LiteralPath 'AGENTS.md'
git status --short --branch
git status --porcelain=v1
git branch -vv
git branch --list custom/dev
git remote -v
git log -5 --format=fuller
git rev-parse HEAD
git config --local --get-regexp '^(remote\.|branch\.|push\.|core\.hooksPath)'
git config --get remote.pushDefault
git config --get push.default
git for-each-ref --format='%(refname:short) %(objectname)' refs/remotes/origin/dev refs/remotes/origin/custom/dev refs/remotes/upstream/dev
git rev-list --left-right --count dev...custom/dev
git rev-list --left-right --count custom/dev...upstream/dev
git ls-files yarn.lock AGENTS.md docs
git ls-files docs .github
git check-ignore yarn.lock
node --version
npm --version
yarn --version
git --version
python --version
py --list
Get-Command node,npm,yarn,git,python,msbuild,cl -ErrorAction SilentlyContinue
node -p 'JSON.stringify({arch:process.arch,platform:process.platform,abi:process.versions.modules})'
& 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe' -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
& 'C:\Program Files (x86)\Microsoft Visual Studio\Installer\vswhere.exe' -products '*' -format json
Get-FileHash -Algorithm SHA256 -LiteralPath 'yarn.lock'
```

使用 `rg --files`、`rg -n`、`Get-Content`、`Get-ChildItem`、`Test-Path` 检查根目录文件组织、package.json、yarn.lock、.yarnrc、.gitignore、Vite/Vitest/TypeScript/Playwright 配置、README、LICENSE、scripts/patch-nan.js、.github 工作流与指引、main/preload、存储与更新/TTS 调用点。所有源码检索显式排除 `src/assets/lib/**`；未读取禁止的压缩引擎文件；构建/类型工具正常消费工程依赖不属于人工源码审读。

依赖完成链接后只读检查了 node_modules 内 Electron、better-sqlite3、esbuild 的 package.json 及 Electron install.js，以确认脚本与安装状态；没有修改其源码。核验指定的两个引擎源码目录均不存在。

## 依赖安装（已执行，失败）

审阅根安装脚本后，在命令进程内将 YARN_CACHE_FOLDER、ELECTRON_CACHE、ELECTRON_BUILDER_CACHE、npm_config_devdir 指向任务专用临时缓存，并用 Tee-Object 保存输出。没有设置全局包管理器配置。两次执行的实际安装命令相同：

```powershell
yarn install --frozen-lockfile --non-interactive --network-timeout 30000
```

首次网络受限而失败；第二次经权限审查允许扩大网络权限，下载/链接后原生构建报错。之后向该安装会话发送 Ctrl+C 结束等待。没有执行 `yarn install --ignore-scripts`、升级/降级依赖、删除 node_modules 或安装系统编译组件。

## 验证（已执行）

```powershell
yarn typecheck
yarn test
node --check main.js
node --check preload.js
node --check chat-preload.js
git diff --exit-code -- package.json yarn.lock main.js preload.js chat-preload.js .github
git diff --stat
git status --short --branch
```

类型检查和单测在依赖安装报错后对已链接的 JavaScript 依赖执行；两者独立命令并行，均退出 0。三个语法检查退出 0。

## 安装目录与 TTS 参考（只读）

```powershell
Get-ChildItem -LiteralPath 'D:\Program Files (x86)\Tools\Koodo-Reader\resources'
Get-ChildItem -LiteralPath 'D:\Program Files (x86)\Tools\Koodo-Reader' -Filter '*.exe'
Get-Process -Name '*koodo*' -ErrorAction SilentlyContinue
Get-Content -LiteralPath 'D:\Program Files (x86)\Tools\Koodo-Reader\resources\app-update.yml'
Test-Path -LiteralPath 'C:\Users\Binte\AppData\Roaming\koodo-reader'
Test-Path -LiteralPath 'C:\Users\Binte\AppData\Roaming\Koodo Reader'
git -C 'D:\MyProjects\Extensions\Azure-MiMo-TTS-Chrome' status --short --branch
git -C 'D:\MyProjects\Extensions\Azure-MiMo-TTS-Chrome' rev-parse HEAD
git -C 'D:\MyProjects\Extensions\Azure-MiMo-TTS-Chrome' remote -v
Get-FileHash -Algorithm SHA256 -LiteralPath 'D:\MyProjects\Extensions\Azure-MiMo-TTS-Chrome\providers.js','D:\MyProjects\Extensions\Azure-MiMo-TTS-Chrome\catalog.js'
```

读取 EXE VersionInfo；使用本仓已链接的 `@electron/asar.extractFile` 只读取安装 ASAR 的 package.json、计算 main.js SHA256，未展开整个包、未加载其中业务代码。尝试读取 ASAR 内 better-sqlite3/package.json 失败，见验收报告。外部 TTS 仓库的三条 Git 命令返回 Permission denied，源码文件读取正常；未提权追查 Git 信息，改用文件 hash 留证。

本轮读取了该扩展的 providers.js、catalog.js、reader.js、manifest/README、现有测试及 .gitignore，检索 player 的取消逻辑；未运行扩展测试或服务请求，未读取账户配置。

为调查安装进程等待，曾执行只筛选本轮 Yarn 安装的 `Get-CimInstance Win32_Process -Filter "Name = 'node.exe'"`，沙箱返回无法访问 CIM 资源；没有据此终止任何其他进程。

## 文档与日志操作（已执行）

通过 apply_patch 新建 `docs/custom/` 七份文档。`New-Item -ItemType Directory` 创建忽略目录 `dist/phase0`，将任务临时目录中的安装日志 `Copy-Item` 到该目录，保存类型、测试、安装包对比、Git/环境快照；没有覆盖用户业务文件。

对新增 Markdown 的本地链接进行了存在性核对，对文档空白格式、Git tracked 差异、HEAD、锁文件哈希作最终复核；这些是文档与范围检查，不替代应用功能验证。

另通过只读官方网页核对 node-gyp Windows 前提、Electron app 路径 API、Azure Voice List/SSML；来源链接保存在相关文档，未据网页改变业务实现。

## 明确未执行

没有运行 `yarn build/start/dev/ele/rebuild/release/test:e2e`、electron-builder 打包、安装程序、数据库迁移或云同步；没有创建/触发 GitHub 工作流，没有上传、发布、commit 或 push。Web 构建和本地安装包构建按用户要求跳过；未安装 Windows 编译组件。
