# Windows 实施记录

日期：2026-10-31。用户已授权自主推进 Windows 修改；实现与 Phase 0 报告分开记录，避免改写历史验收结果。

## 已实施

- 在 feature/windows-custom 开发，保留原 custom/dev/dev/upstream 跟踪关系；所有者在源码验收后授权本次单独提交、推送该功能分支。
- src/custom/sync：白名单数据适配、完整文件 SHA256、UUID 映射、向量因果/多版本冲突、删除标记、统计设备增量、待绑定书籍数据、设置与自动调度。
- src/utils/main/custom：MEGA/文件夹传输、系统加密会话、互斥/路径绑定、原子检查点、验证后快照保留、本地备份和恢复。
- database-command 增补批次 CAS 分支；数据库连接缓存按书库路径和库名区分，避免复用错误路径的连接。没有从 renderer 引入 SQLite。
- Azure 语音保留 StyleList，按音色选情绪；SSML 转义/locale/命名空间、Azure 百分比换算、凭证无关的 v2 音频缓存、网络超时与固定错误。取消旧队列任务，停止时不再用延迟定时器清空新会话缓存。
- 独立 Custom 身份与 profile，UI/主进程阻断官方二进制更新；保留上游 URI 兼容；仅准备云端无发布 Windows x64 zip。
- 英文与简体中文的新界面文案；既有官方功能和付费服务授权条件未删除。

## 实际验证与命令

已执行 git switch -c feature/windows-custom；后续反复执行 yarn typecheck、yarn test、node --check main.js/scripts/custom-smoke.cjs/新增主进程模块、git diff --check，修复测试暴露的问题后再验证。最终结果与日志保存在 dist/windows-validation（不纳入 Git）。

源码验收记录（2026-10-31，针对本次交付的源码改动）：

| 检查 | 实际结果 |
| --- | --- |
| `yarn typecheck` | 退出码 0，TypeScript 检查通过 |
| `yarn test` | 退出码 0，7 个文件 / 40 项测试全部通过 |
| `node --check` | main/preload、冒烟脚本、4 个 custom 主进程模块、2 个 Azure 模块通过 |
| `git diff --check` | 通过；Azure 文件只有 Git 的 LF/CRLF 提示 |
| electron-builder 配置校验 | 调用本地 `getConfig/validateConfiguration` 通过；未执行打包 |
| 工作流配置 | YAML 可解析，手动/可复用触发、只读仓库权限、禁止发布及功能分支路由已检查；未触发 Actions |
| 文档与本地化 | 11 份 Markdown、16 个本地链接、89 个中英文 custom key 检查通过 |
| 本地 Web / Electron 构建及 GUI 启动 | 按用户要求未执行，不能报告通过 |
| 原生模块 / 真实 MEGA、Azure / 阅读器人工回归 | 尚未验收；保留为正式使用门槛 |

`typecheck.log`、`test.log`、`builder-config.log`、`workflow-routing.log`、`documents-locales.log` 位于上述日志目录。类型检查使用 `tsc --noEmit`；测试的 SQLite 实验只在内存中执行。日志中的 Node SQLite experimental 提示不代表测试失败。

自动化覆盖真实文件夹读写、真实公开 ConfigService/ReadingTimeUtil 与 Node 内存 SQLite 转换、双设备完整同步生命周期、三设备乱序/重复消息、时间戳碰撞、并发冲突、删除、离线计时、上传期间编辑、事务失败/重试、本地离线恢复、凭证排除、测试 profile 拦截、MEGA 接口契约和 TTS 缓存/暂停恢复。

曾发现并修复：新设备相同初始书籍 metadata 引入伪冲突；上传后的未应用数据被提前确认因果；恢复空配置写成字符串 null；MEGA 恢复会话缺少文件树加载/ready 状态问题；旧 TTS 异步任务与延迟清理污染新会话缓存。测试是为这些可观察行为与失败模式设计，而非仅镜像函数实现。

Windows 实施阶段没有重新安装依赖、改动 yarn.lock 或安装系统编译组件；Phase 0 的依赖安装与原生编译失败仍见原验收报告。本地 Node 为 24.13.0；CI 指定 Node 22.14.0，跨版本与 Electron ABI 结果由尚未运行的 workflow 验证。

Azure-MiMo-TTS-Chrome 的参考落实为语音能力元数据 → 情绪选择 → SSML → 缓存参数的一致传递，按 Koodo 的 IPC、队列、文件缓存和 i18n 重新实现，未复制扩展文件或修改参考项目。没有引入 MiMo Provider 或自动情绪分析。

交付分支为 `feature/windows-custom`，改动基于 `42443d83f9a536a3e1c501991ac8b6f635e69bc1`；交付提交以 Git 历史为准。所有者在本地源码验收后授权单次提交与推送。`dev` 与 `custom/dev` 保持原跟踪关系，upstream push URL 为 `DISABLED`。

提交前确认 Fork 默认分支是 `dev`，专用的新工作流尚未登记在默认分支，因此补充现有 `Build/release` 手动入口：仅在 feature/* 或 custom/* 分支调用自定义 Windows 流程并跳过官方多平台任务。这一接入只随功能分支提交，不修改远端 dev，不自动触发构建或发布。

## 未取得的结论

没有执行本地 yarn build/dev/ele/release、没有修改已安装程序、没有启动真实书库、没有真实 MEGA/Azure 调用、没有云端构建或实际 Windows 阅读窗口手工回归。因而只能报告源码与本地自动化验证完成，不能报告 Windows 产物或真实服务验收通过。

统计 v1 是累计语义，不支持把本机减计数当作远端 reset；首次旧历史采用 max 基线，完整历史去重不能凭现有快照推断。合集与通用偏好不在同步白名单。以上边界在 UI/协议/使用说明中明确，移动实现尚未开始。
