# 桌面上游更新预检（2026-11-15）

从桌面 `custom/dev` 的 `851fe634` 创建 `codex/integrate-upstream-20261115`，以 `git merge --no-commit --no-ff bfaa73b3` 准备本轮更新。官方共同基线为 `2650709b`；本轮有 112 个新增提交（包含合并提交）、143 个上游变更文件，应用版本由 2.4.7 升至 2.4.8。已 fetch 核实 `origin/dev` 与 `upstream/dev` 同为 `bfaa73b3`。

预检完成后，所有者明确授权本轮提交、推送并合入 `custom/dev`。交付采用先在升级分支创建保留两个父提交的合并提交，再将 `custom/dev` 快进至该提交并推送 Fork 的 `custom/dev`；实际提交与远端位置以 Git 记录为准。不移动干净的本地 `dev` 或安卓分支，不创建标签或 Release，不安装或更新本机程序。原有未跟踪的 `android/`、`build-android/` 和个人数据迁移文档保留在原处，不纳入本轮提交。

## 官方更新范围

- 阅读器快捷按钮及窗口状态、背景图片、覆盖翻页动画、电量与章节字数、按书保存阅读辅助模式、自动滚动速度上限调整。
- 阅读统计日期范围、按书筛选与阅读时长排行；可选模拟书脊、解散集合、回收站单本删除。
- Markdown / HTML 笔记、预览与导入导出；OPDS 说明 HTML 过滤、脚注与外链导航防护。
- 本地多词典聚合，扩展 StarDict、DICT、Slob、BGL 格式；新增 `lzma1@0.8.0` 解压依赖。
- Windows SAPI 5 音色插件、语音动态枚举及 worker 生命周期；HTTP 服务 CORS 白名单。

依赖和锁文件仅接收上游的版本及 `lzma1` 变化。已按锁文件安装并跳过依赖安装脚本；为阅读回归单独准备 Electron 35.7.5 开发运行时。没有安装 Windows 原生编译工具或执行生产构建。许可证文件没有变化；新增词典解析文件保留上游的第三方来源与许可说明。

## 合并与兼容修正

8 个文本冲突文件均已逐项处理：`main.js`、英文翻译、PopupDict、PageWidget、SettingPanel、AppearanceSetting、Viewer 和 Zustand store。

- 主进程保留 Custom profile 初始化、启动早期单实例锁、自有同步及数据库 CAS；接收上游导航防护，避免重复声明单实例锁。
- 保留个人模式的官方插件过滤，接收本地词典聚合和 SAPI 动态音色；保留翻页取消定制 AI 翻译请求，同时接入电量与章节字数。
- 设置面板采用上游 ConfigService API，兼容读取旧的页签偏好；清除样式仍经过 Custom 磁盘偏好持久化。
- E-ink 与模拟书脊开关共存；Viewer 同时清理选字保护和覆盖动画。E-ink 下禁止覆盖翻页截图及动画，原有动画和背景偏好保持保存值。
- 沿用阅读器现有鼠标监听及节流，改用最后移动时间判断，移除每个鼠标事件新建的定时器；隐藏工具栏时不重复重置同一隐藏定时器。
- 保留 Custom 独立身份、禁用官方安装更新、个人 AI / TTS / MEGA、自有同步协议及两个构建工作流。

## 笔记与同步兼容

新增笔记 `type` 字段支持 `text` / `markdown` / `html`。自有同步仅允许这三个值；富文本笔记同步时保留格式，远端旧笔记缺少类型时按纯文本应用，避免沿用本地先前的 HTML 类型。

纯文本发送时省略 `type`，继续使用原来的 v1 数据结构；因此旧版纯文本笔记不会仅因升级而产生格式变更。富文本以可选字段扩展 v1：旧版严格校验器会拒绝含富文本类型的快照。使用富文本自有同步前，需要升级所有参与同步的客户端，包括仍基于旧协议字段的安卓客户端。本轮未将桌面更新合入安卓。

未访问、迁移或同步真实书库。现有数据库迁移通过上游公开 SQL 接口执行；单测使用内存 SQLite 验证新增类型、CAS 与回滚。

## 阅读引擎

没有阅读或修改压缩引擎源码，只核对 Git 对象并消费公开 API：

| 产物 | 原对象 | 官方目标 |
| --- | --- | --- |
| `kookit.min.js` | `494c55980b28f7ecb41aea6ad8884b4ad2fdf83f` | `143d8a1e19e33e5c2ff3e303a91181a0a9b4d3fd` |
| `kookit-extra.min.mjs` | `25e9ab96892c4b70227ce6903434b35bdd097144` | `35fee4629a236dd198f21015fe5bad332532e097` |
| `kookit-extra-browser.min.js` | `e5ce8b3620313c1d426785ee0c1a05503f9578aa` | `6d0c33a650542e1d0523dbc3dbd56e49d309bed5` |

## 验收与边界

- TypeScript 类型检查通过。
- Vitest 20 个文件、187 项测试通过，包含词典 / SAPI 上游测试，以及笔记格式往返、纯文本兼容、同步重试与样式批量更新持久化检查。
- 隔离 Windows 阅读回归的 21 个检查项通过：本轮使用当前仓库主进程、preload、Electron 开发依赖及 Vite 渲染源码。覆盖输入法锁、导航面板、翻页故障恢复、选字、标签、朗读面板及真实 Howler 暂停恢复、迟到回调、Markdown 保存及预览、HTML 过滤、E-ink 覆盖动画禁用和主题恢复。
- 所有 Electron 可写位置位于新建 `krc-test-reader-*` profile，使用合成 HTML 书籍、内存系统语音和合成音频，阻断外部网络；测试正常结束后清理隔离 profile。
- 主进程和 preload 语法检查通过。未读取真实模型凭证，也未请求真实 AI / MEGA / SAPI 发声服务。

复现命令：

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn start --host 127.0.0.1 --port 3000 --strictPort
# 在另一个终端执行；使用当前源码，无需安装新的 Custom 产物
node scripts/custom-reader-smoke.cjs --source-main
```

本机受限沙箱的系统临时目录存在路径映射问题；单测将 `TEMP` / `TMP` 指向 `dist/upstream-audit-20261115/tmp` 后通过。Electron 和本机 Vite 需要运行于同一可互通的环境。最初使用旧安装包的检查因旧 preload 缺少新通道而失败，不能作为本轮验收；最终以当前源码的成功运行记录为准。

本地日志保存在忽略目录 `dist/upstream-audit-20261115/`。没有运行本地生产构建或桌面打包；Windows ZIP、真实书籍各格式、SAPI 实际发声和多设备实网同步仍需后续产物验收。本机未安装 Go，未执行新增 HTTP CORS 测试。以上限制不影响已记录的类型、单测和合成 HTML 阅读结果。

## 桌面程序更新

提交和推送源码不会更新已安装的桌面程序。要使用本轮 2.4.8 功能，需要重新生成完整 Windows 包。推送 `custom/dev` 会触发现有 **Custom Windows verification**，构建成功后在该运行的 Artifacts 下载 `koodo-reader-custom-windows-<提交 SHA>`。

关闭旧程序并备份当前 Custom 数据目录；若已更改存储位置，以设置中当前实际书库及 profile 位置为准。解压 artifact 外层下载包，再将其中 `Koodo Reader Custom-2.4.8-x64-Win.zip` 完整解压到新的程序目录，运行新版 `Koodo Reader Custom.exe`，沿用现有 Custom profile。无需卸载或重新导入书库，也不要混用新旧 `app.asar` 和原生模块。源码提交成功与 Windows 产物成功分开核验，以 Actions 的最终状态为准。
