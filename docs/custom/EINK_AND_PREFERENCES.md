# E-ink 与应用配置持久化

2026-11-01。本次提交包含源码修改与回归检查；未在本机构建或替换已安装的软件。

## E-ink 模式

“设置 → 外观”新增开关。参考本地 anx-reader-custom 的主题实现，界面强制浅色、黑白主题色、清晰边框，关闭阴影和动画。关闭开关后恢复之前选择的主题和主题色；书籍自身的文字/背景配置保留。

## 配置保存

AI 模型、Discord 开关、书库位置及其他 ConfigService 配置原先仅保存在 Chromium localStorage。现在通过经过参数校验的 `preferences` IPC 同步写入 Custom profile 的 electron-store，在 React、Zustand 和主题初始化前恢复。

首次启动迁入当前 localStorage；后续启动以磁盘配置为准，恢复新增、修改和删除。`storage-location` 的回退值也使用保存的书库位置。切换书库时不会让库内 config.json 的旧路径覆盖新选择的目录。“清空所有数据”同时清除持久化配置，并在清理前记住当前书库位置。

代理仍通过原有主进程配置保存。此前保存后隐藏输入框且没有编辑入口；现在启用代理时始终显示已保存的配置，可继续编辑。

配置仍属于 `%APPDATA%\koodo-reader-custom`，迁移书库不等于迁移整个应用 profile；不要删除该 profile 来清理旧软件。此次没有写入正式 profile 或 E 盘书库，也没有自动覆盖旧备份。

## 验证

- 类型检查通过；Vitest 12 个文件 / 82 项测试通过，覆盖真实公开 ConfigService API、已有配置迁入、全新浏览器存储下的磁盘恢复、删除不复活、磁盘写入失败、IPC 校验、清空数据，以及 E-ink 开关前后的主题恢复。
- `scripts/custom-smoke.cjs` 增加真实 Electron 界面开关、重启、清除 Chromium localStorage 后恢复、迁移书库、AI/Discord/代理保留及代理字段显示检查。该脚本由既有 Windows 工作流在构建后运行。
- 本机没有构建或打包；真实 Electron 冷启动、界面及阅读器手动回归仍需使用新构建验证，不能将单元测试视为这些检查已经通过。
