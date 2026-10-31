# Phase 0 验收报告

执行日期：2026-10-31（Asia/Shanghai）。当前仅完成 Phase 0 授权范围内的检查、验证与治理文档；**没有取得完整桌面构建/启动通过结论**。不得将本报告视为进入 Phase 1 的授权。

## 验收结果

| # | 验收项 | 实际结果 |
| --- | --- | --- |
| 1 | Git 与分支 | 开始时干净；位于 `custom/dev`，跟踪 `origin/custom/dev`。`dev`、该分支和三个相关远端缓存引用同一基线。结束时仅新增 `docs/custom/` 文档；没有提交或推送 |
| 2 | 实际命令 | 见下文及 [PHASE0_COMMANDS.md](PHASE0_COMMANDS.md)；保留安装、类型、测试和安装包对比日志 |
| 3 | 依赖安装 | **完整安装失败**。首次 DNS 失败；扩大网络权限后下载、链接完成，但 better-sqlite3 原生构建失败；不补装编译器。结束仍在等待的安装过程，未完成根 postinstall |
| 4 | TypeScript | **通过**：`yarn typecheck` → `tsc --noEmit`，退出码 0，33.27 秒 |
| 5 | 单元测试 | **通过**：`yarn test` → `vitest run`，退出码 0，1 文件 / 1 测试；仅验证 Book 模型核心属性 |
| 6 | Web 构建 | **未执行**：用户明确表示当前不需要，不运行 `yarn build` |
| 7 | Electron | **启动、桌面打包未验证**。仅静态检查启动条件，并对 main/preload 做语法检查；不启动真实程序，不在本机安装编译组件；后续由 GitHub 云端构建，本轮未触发 |
| 8 | 官方更新覆盖 | **存在风险，未修复**：官方 API、Windows 下载执行链、官方 appId/productName/publish 目标均保留；安装包内更新配置也指向官方 |
| 9 | 测试数据隔离 | **本轮单测不访问真实数据**，只在内存构造 Book。没有启动应用、导入书籍、连接真实 SQLite、调用账户同步或 TTS 服务；完整应用隔离方案仅完成设计，尚未实施/验证 |
| 10 | 后续风险 | 原生依赖/ABI、安装包与源码差异、云端构建身份及更新隔离、真实持久化契约、引擎源码/许可、统计同步均需后续处理 |

## Git 事实及交接差异

HEAD：`42443d83f9a536a3e1c501991ac8b6f635e69bc1`，版本 2.4.6，与交接基线一致。

| 分支/引用 | HEAD | 跟踪 |
| --- | --- | --- |
| `custom/dev`（当前） | `42443d83` | `origin/custom/dev` |
| `dev` | `42443d83` | `origin/dev` |
| `origin/custom/dev` | `42443d83` | 本地远端缓存 |
| `origin/dev` | `42443d83` | 本地远端缓存 |
| `upstream/dev` | `42443d83` | 本地远端缓存 |

交接文档中“custom/dev 尚未确认”的状态已过时：分支和 origin 对应引用已存在。upstream push URL 已设 `DISABLED`。因此未创建/切换分支，也未改远端或 Git 配置；没有 reset、clean、rebase、commit、push 或 fetch。

## 环境与工程检查

| 项目 | 实测/静态结果 |
| --- | --- |
| OS / 架构 | Windows，Node 平台 `win32` / `x64` |
| Node | 24.13.0，主机 Node ABI 137；满足 package 要求 `>=22.12.0`，但不同于 CI 的 Node 22 |
| npm / Yarn | npm 11.6.2；Yarn Classic 1.22.22。根 README、AGENTS、CI 和 yarn.lock 表明使用 Yarn |
| Git | 2.36.1.windows.1 |
| Python | `python --version`: 3.12.8，可执行文件位于 `D:\Program Files\Python\Python312\python.exe`；`py --list` 未检测到已登记 Python，与实际 python 可用不矛盾 |
| Windows 原生工具 | PATH 未找到 cl/msbuild；vswhere 未返回可用的 VC x86/x64 安装，常见 Windows SDK 路径未发现；安装过程进一步证实缺少 VS 工具链。不安装任何组件 |
| 锁定依赖 | Electron 35.7.5、better-sqlite3 13.0.3、Vite 6.4.5、Vitest 5.0.5、electron-builder 26.16.1 |
| 复现缺口 | 未声明 packageManager；本机 Node 24 与 CI Node 22 有差异；node-gyp resolutions 锁为 10.3.1，但首次原生安装实际调用 npm 内置 11.4.2，应以日志为准 |

`yarn.lock` 已被 Git 跟踪，尽管 `.gitignore` 同时列出 yarn.lock；不能误判为无锁文件。安装前后 SHA256 相同：

`2DEF1FB99530F804D9B21B1BE7CBD78998771F1D5FC3C6D1BB958BA398B529CF`

根 postinstall 为 `node scripts/patch-nan.js && electron-builder install-app-deps`。前者仅补丁 node_modules/nan/nan.h，后者准备 Electron 原生依赖；没有源码表明它们会启动阅读器或修改书库。依赖自身也会执行下载和 node-gyp 脚本，因此完整安装仍需要网络及原生环境。对比官方要求，[node-gyp Windows 说明](https://github.com/nodejs/node-gyp#on-windows)列出 Python 与 Visual C++ 构建环境；遵循用户要求不补装。

## 安装与错误证据

第一次在受限网络中执行：

```text
yarn install --frozen-lockfile --non-interactive --network-timeout 30000
error Error: getaddrinfo ENOTFOUND registry.yarnpkg.com
PHASE0_INSTALL_EXIT_CODE=1
```

扩大网络权限后执行同一安装命令，下载与链接完成，出现以下错误：

```text
[5/5] Building fresh packages...
cpu-features: Error: Unable to detect compiler type
register-scheme: Error: Could not find any Visual Studio installation to use
error ...\node_modules\better-sqlite3: Command failed.
Exit code: 1
Command: node-gyp rebuild
gyp info using node-gyp@11.4.2
gyp info using node@24.13.0 | win32 | x64
gyp ERR! stack Error: Could not find any Visual Studio installation to use
```

前两个为可选依赖告警，better-sqlite3 是必要依赖，不能将整体安装判为成功。安装进程在报错后仍等待其他安装任务，已发送 Ctrl+C 结束，进程退出码 1。没有安装 VS、MSVC 或 Windows SDK，没有改 package.json 或锁文件规避失败。

JavaScript 依赖已可用，随后完成类型检查和唯一单元测试；这不证明原生数据库可用。检查时没有 `node_modules/electron/dist/electron.exe`、better-sqlite3 本地构建输出和 `.yarn-integrity`，因此不尝试 `yarn dev`。

## 已安装 Windows 程序的只读核验

用户指定：`D:\Program Files (x86)\Tools\Koodo-Reader`。

- EXE FileVersion 2.4.6 / ProductVersion 2.4.6.0；resources 中有 app.asar（100,675,583 bytes）、app.asar.unpacked 和 app-update.yml。
- ASAR 内 package.json：name `koodo-reader`、version 2.4.6、main `main.js`；better-sqlite3 声明为 `^11.6.0`，与本地源码 `^13.0.3` 不同。
- ASAR main.js SHA256：`141bfde425b01017327cee0da4ed3cc0f9d288ce55b9ec84d554daa976a64075`。
- 源码 main.js SHA256：`96415d6eaa8d907655c94f5805557e9ceb6e18d9fa7374a68df9d44e0405475d`。
- 尝试只读提取 ASAR 中的 `node_modules/better-sqlite3/package.json` 返回“was not found in this archive”，因此没有确认该安装的实际 resolved 版本/ABI，也没有确认其源码 commit。
- 查询时未发现 Koodo 进程；没有运行或终止已安装程序，也没有替换任何资源。

结论：用户安装可作为后续增量部署目标，但不能把同一版本号当作同一源码和依赖基线。调试可免安装包，仍须匹配构建资源与原生依赖，备份与隔离流程见 [ADR](ARCHITECTURE_DECISIONS.md)。

## 数据与更新边界

源码和包内应用名确定默认 profile 为 `%APPDATA%\koodo-reader`；仅确认该目录存在，没有读取其配置或书库。默认书库路径由 main.js 推导为 `%APPDATA%\koodo-reader\uploads\data`，SQL 位于 `<storageLocation>/config/<dbName>.db`；用户自选 `storageLocation` 可改变实际位置，未读取真实配置，因此不能报告用户实际书库位置。

本轮只运行纯内存 Book 单测。完整应用启动会创建 electron-store、注册协议、申请单实例锁，并可能进行更新/同步检查；故没有用默认 `yarn dev` 做安全性未知的运行验证。测试 profile 必须在官方模块加载前设置，并验证配置、Chromium session、数据库、缓存、日志、临时文件、协议与网络副作用都被隔离。详见 [ADR](ARCHITECTURE_DECISIONS.md)。

Windows 更新覆盖风险见 [UPSTREAM_POLICY.md](UPSTREAM_POLICY.md)。当前只是确认并记录，未修复。程序资源回滚与数据库回滚是不同操作；本轮未建立或声称存在可用的真实数据恢复点。

## 文档与产物

仅新增本目录下 7 个 Markdown 文件。完整运行日志留在忽略目录 `dist/phase0/`：`install-network-retry.log`、`typecheck.log`、`test.log`、`installed-comparison.log`，最终另存 Git 和环境快照。下载及 node-gyp 缓存在 `%TEMP%/koodo-reader-custom-phase0-20261031`；均不进入版本控制。没有清理这些缓存或用户数据。

## 下一步建议（尚未授权）

1. 先准备 GitHub Windows x64 无发布构建验证，解决原生依赖及 ABI，明确本地只检查 JS 的依赖准备方式；不要求本机安装编译组件。
2. 验收独立测试 profile 和副作用隔离后，再进入 Phase 1 数据契约审计。
3. 获取可核验的引擎源码/许可，补齐 ConfigService、直接 SQL、ReadingTimeUtil 的持久化矩阵。
4. 自定义版本接触真实数据前，决定构建身份、更新隔离、备份与回滚边界。
5. TTS 后续可参考已审计的 Azure-MiMo-TTS-Chrome，先补语速和缓存契约测试，再考虑移植情绪逻辑；本轮不实现。
