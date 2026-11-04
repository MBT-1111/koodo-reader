# 桌面上游更新预检（2026-11-05）

在 `codex/integrate-upstream-20261104` 完成官方更新的预合并、冲突修正与本地检查。该分支从桌面 `custom/dev` 的 `7207148b` 开始，官方共同基线为 `dbcb7453`，本轮目标为 `upstream/dev` 的 `2650709b`，包含 30 个新增官方提交。原有定制提交保持历史关系，没有 reset 或改写提交。

当前版本仍为 2.4.7。`package.json`、`yarn.lock`、Custom 产品身份、独立 profile、官方更新禁用、自有同步协议和两个构建工作流均未改变。安卓分支保持 `e05af81f`，没有将本轮桌面更新合入安卓。

## 官方更新范围

- 阅读器原顶部操作与进度面板重构为 `ReaderTopToolbar`、`ReaderBottomToolbar`，移除旧顶部/底部侧边面板快捷操作。
- 新增 `KeepMounted`，整理阅读对话框、翻译弹窗布局和流式翻译文本更新。
- 调整书籍/集合选择、删除确认、图标字体和范围输入样式。
- Electron 文件拖入使用 preload 的 `webUtils.getPathForFile()`，新增总存储占用查询。
- 更新阅读引擎产物及 macOS 标题栏行为；没有依赖或许可证文件变化。

## 合并与兼容修正

文本冲突仅出现在 Header、PageWidget 和 Reader 三处，已经逐项解决：

1. Header 同时保留个人版隐藏官方账户入口与官方新增的域名条件，自有同步入口保留。
2. PageWidget 保留翻页时取消个人 AI 旧翻译请求，避免旧结果进入新页面。
3. Reader 使用新上下工具栏，将定制的朗读按钮点击开关行为传给新顶部工具栏。播放器仍按书籍 key 保持挂载，隐藏面板不会重建播放实例；保留正文关闭面板、输入法组合状态及阅读时长关闭协议。其他设置对话框采用官方 `KeepMounted`。

另外修正两处升级兼容边界：

- 新底部工具栏的翻页锁在 `finally` 释放，与现有键盘/滚轮的失败释放行为一致，避免导航或保存出错后永久无响应。
- 新增的 `get-cache-size` / `all` 仅统计当前主进程的实际书库与听书缓存；拒绝外部目录、子目录、相对路径和非字符串覆盖参数，不接受渲染进程任意指定扫描目录。

全文翻译设置自动合并产生的重复写入已去除，保留个人模型配置检查和官方的新配置写入时序。MEGA 同步与 profile 启动修复所在的 `src/utils/main/custom/` 未变。

## 阅读引擎与数据边界

没有读取或修改压缩引擎源码，只核对 Git 对象与公开接口行为：

| 产物 | 原对象 | 官方目标 |
| --- | --- | --- |
| `kookit.min.js` | `fdc499e527416eccce8e23624b2aedd6bdbf915d` | `494c55980b28f7ecb41aea6ad8884b4ad2fdf83f` |
| `kookit-extra.min.mjs` | `25e9ab96892c4b70227ce6903434b35bdd097144` | 不变 |
| `kookit-extra-browser.min.js` | `e5ce8b3620313c1d426785ee0c1a05503f9578aa` | 不变 |

自有同步实体字段与数据协议保持现有 v1；没有读取、迁移或同步真实书库。原有未跟踪的 `android/`、`build-android/` 和个人数据迁移文档保留，不纳入升级。

## 验收

- TypeScript 类型检查通过。
- Vitest 19 个文件、149 项测试通过。新增缓存 IPC 合约检查执行实际注册的处理器，验证当前目录、默认目录、旧缓存类型及拒绝路径，无真实目录扫描。
- 隔离 Windows 阅读检查 19 项通过：原有输入法锁、目录开关、固定恢复、朗读选字、笔记标签、播放器隐藏/重开、系统与自有音频暂停/继续、迟到回调取消、E-ink 与动画生命周期，以及新增真实 File 路径取得、非法对象拒绝和工具栏故障后恢复。
- 运行环境为现有 Custom Windows 程序，渲染源码来自本机 Vite；新增文件路径接口另在隐藏测试窗口加载当前 preload 验证。所有 Electron 可写位置均指向新建 `krc-test-reader-*` profile，外部网络阻断，书籍、语音与目录均为合成样本，结束后清理。

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn start --host 127.0.0.1 --port 3000 --strictPort
# 另一个终端，使用支持 KRC_TEST_PROFILE 的已安装 Custom 程序
node scripts/custom-reader-smoke.cjs 'D:\Program Files (x86)\Tools\Koodo Reader Custom-2.4.7-x64-Win\Koodo Reader Custom.exe'
```

本地记录在忽略目录 `dist/upstream-audit-20261104/baseline.json` 和 `dist/custom-reader-smoke.json`，E-ink 截图为 `dist/reader-eink.png`。本轮没有编译桌面生产资源、打包、安装更新或更改已安装程序；完整的新主进程与渲染资源打包、Windows 产物及其他书籍格式回归仍由 Custom Windows 流程与后续产物验收覆盖。本地阅读检查使用合成 HTML，不将它写作全部格式验证。

## 所有者授权与交付

2026-11-05，所有者确认“可以提交推送”，授权本轮合入、提交和推送。交付方式为先提交本升级分支，保留桌面定制与官方更新两个父提交，再将 `custom/dev` 快进至该提交并只推送 Fork 的桌面集成分支。不推送官方仓库、干净的 `dev` 或安卓分支，不创建标签、Release 或安装更新。推送会触发现有 Custom Windows 验证流程，提交与远端引用以 Git 记录为准，产物成功与否以 Actions 为准。
