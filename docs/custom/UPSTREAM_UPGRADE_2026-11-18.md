# 桌面上游更新与统计页修复（2026-11-18）

从 `custom/dev` 的 `ab767ba11bc41d8a81021e6f2576897bfa4f40e6` 创建 `codex/integrate-upstream-20261118`，执行 `git merge --no-commit --no-ff 889146271a26441b46d9530991a2a8b439210f36`。官方基线从 `bfaa73b3` 推进到 `88914627`，新增 33 个提交（包含合并提交）、79 个变更文件；没有文本冲突。fetch 后 `origin/dev` 与 `upstream/dev` 指向同一目标。

本地预检完成后，所有者于 2026-11-18 明确要求提交推送本轮更新。交付采用先在升级分支创建保留两个父提交的合并提交，再将 `custom/dev` 快进至该提交并推送 Fork 的 `custom/dev`；实际提交与远端位置以 Git 记录为准。不移动本地 `dev` 或安卓分支，不创建标签或 Release，不安装或更新本机程序。原有未跟踪的 `android/`、`build-android/` 和个人数据迁移文档保留，不纳入本轮提交。

## 官方更新范围与兼容

- 无封面图书的新封面设计、格式配色、作者信息和书脊阴影；封面视图间距及加入书架对话框布局修复。
- 阅读窗口宽度自动选择单页或双页，只更新运行时模式，保留手动设置；支持格式才展示偶数页渲染选项。
- Electron 阅读区滚动条悬停、阅读辅助开关布局、AI 面板打开后定位最新消息等修复。
- 推荐背景加载提示、选书时隐藏已入书架的集合、多语言翻译补全。
- MDict 按需解析键块；无序块索引回退到完整解析，附带上游测试。

`package.json`、`yarn.lock`、许可证、数据库结构、preload 白名单、自有同步和 Custom 产品身份没有上游变更。保留独立 profile、禁用官方更新、个人 AI / TTS / MEGA 及 E-ink 行为。应用版本号仍为 2.4.8，交付包需要同时核对提交 SHA。

没有读取或修改压缩引擎源码；只核对 Git 对象、调用公开导出接口和查询生成结果。本机提供的 `D:\Project\kookit`、`D:\Project\kookit-extra` 源码路径当前不存在。

| 产物 | 原 Git 对象 | 官方目标 Git 对象 |
| --- | --- | --- |
| `kookit.min.js` | `143d8a1e19e33e5c2ff3e303a91181a0a9b4d3fd` | `0618e9815562d7212d4cdfda769e135fc4568713` |
| `kookit-extra-browser.min.js` | `6d0c33a650542e1d0523dbc3dbd56e49d309bed5` | `34ff2dfd765be74d4efc9b00175c63f3fd55680d` |
| `kookit-extra.min.mjs` | `35fee4629a236dd198f21015fe5bad332532e097` | 未变化 |

## 统计页空白原因与修复

问题在更新前的 Custom 源码上通过隔离 Electron 和合成数据复现：空书库正常，有阅读记录时只显示“阅读统计”标题，控制台出现 `Error invoking remote method 'database-command': RangeError: Too few parameter values were provided`。与用户反馈的已安装 Windows 定制版症状一致；没有读取用户真实书库。

统计页排行通过 `DatabaseService.getRecordsByKeys` 获取书籍。公开 `SqlStatement.sqlStatement.getByKeysStatement` 为保持输入顺序，生成 `WHERE key IN (?, ...) ORDER BY CASE key WHEN ? THEN 0 ... END`。N 个 key 对应 2N 个占位符，但主进程只绑定 N 个参数。异步加载因此拒绝，内容无法显示；单个 key 也会触发。

修复在 `main.js` 的现有 `database-command` handler：SQL 仍以原始 keys 生成，执行时为该查询绑定两组 keys。校验查询模式及 key 数组，空数组直接返回 `[]`。其他查询、写入、数据库格式和阅读历史不变，没有新增 IPC 通道。该修复同时覆盖采用相同批量查询的选书流程。

新增 `scripts/custom-stats-smoke.cjs`，使用真实主进程、preload、公开阅读引擎及 SQLite IPC，覆盖空书库、有阅读记录、已删除书籍的历史、排行榜顺序、按书筛选、日期范围、双图表、热力图、单条/批量/空查询、无效参数和返回书库。Windows 验证流程在编译后的渲染资源上运行此检查，并将结果 JSON 随 ZIP 上传。

## 验证与交付

- TypeScript 检查通过。
- 20 个测试文件、190 项单元测试通过。
- 统计页检查修复前稳定失败，修复后源码模式的 12 项检查全部通过；同时检查截图确认页面正常显示。
- 阅读器源码模式的 21 项隔离检查通过，涵盖翻页错误恢复、导航面板和输入法、选字、富文本笔记、系统与自定义朗读暂停恢复、E-ink 及关闭后的主题恢复。
- `git diff --check` 和合并暂存区检查通过。

日志位于忽略目录 `dist/upstream-audit-20261118/`，统计页结果和截图为 `dist/custom-stats-smoke.json`、`dist/custom-stats-smoke.png`。测试使用临时 profile 和合成记录，阻止外网请求，没有访问、迁移或同步真实数据。阅读器合成 HTML 使用项目外系统临时目录，避免 Vite 监听到测试文件后刷新页面。

本轮也修正既有阅读器冒烟脚本的等待方式：异步条件用 `expect.poll` 轮询，并以 AppState 的 `isReading` 和 `rendition` 判断就绪，替代未保证存在的引擎内部 `audioText` 字段。验证前重启 Vite，清除更新过程中遗留的模块状态。阅读器测试使用合成 HTML、模拟系统语音和合成音频，不等同于所有格式真书、原生音色或远端 Provider 的人工回归。

本机没有执行生产构建或生成安装包。本轮推送 `custom/dev` 将自动触发现有 Custom Windows Actions，为对应提交构建新 ZIP；编译模式的统计页检查及打包结果仍需以 Actions 为准，不把本地检查写作新包已构建成功。

已安装程序需要关闭后替换为对应新构建的完整程序目录，源码更新不会自动修改现有程序。保留 `%APPDATA%\koodo-reader-custom` 及原书库，无需清空统计、重新导入书籍或卸载个人数据。
