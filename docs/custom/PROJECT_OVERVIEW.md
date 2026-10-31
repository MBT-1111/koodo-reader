# Koodo Reader Custom

本目录保存个人分支的治理、审计和实施记录。官方目前以根目录多语言 README 和 `.github/` 维护说明，未发现已有 `docs/`；将个人文档集中在 `docs/custom/`，减少 upstream 合并冲突。

## 范围与授权

- 项目所有者决定产品方向、重要架构选择、提交、推送和发布。
- Codex 承担审计、方案、授权范围内的开发、验证和文档维护。
- 交接时仅授权 Phase 0；随后用户于 2026-10-31 授权“不用询问，先推进完 Windows 端修改”。现授权覆盖 Windows 所需的数据契约、同步、TTS、隔离与构建准备。移动端仍未开始，真实数据修改、Git 提交/推送及发布仍不在本轮执行范围。
- 不主动 commit、push、发布、运行安装程序、清理或迁移真实书库。

## 产品目标

优先保持官方 Windows 桌面端功能和升级兼容性，通过独立模块和少量接入点增加个人能力：

1. 自有账户同步：先研究 MEGA，保留 WebDAV、S3 Provider 扩展空间；独立设计协议、实体标识、冲突、断网恢复、删除传播、版本兼容和备份。API Key、令牌等凭证不进入通用同步载荷。
2. TTS：保留官方 Provider、缓存、语速、暂停恢复、多角色能力；增加当前语音实际支持的情绪选择和 Azure SSML 适配。自动情绪分析留待后续。
3. 官方更新：持续跟踪 upstream，自定义版本发布前隔离官方二进制更新流程。
4. 移动端：独立实现 Android/iOS 客户端；日常使用优先 Windows 和 Android。仅复用已核实公开、许可适用的引擎和逻辑，不依赖未公开移动源码或封闭付费功能。Capacitor 尚未选定，iOS 不属于当前优先验证平台。

不通过绕过官方授权获取付费服务。

## 2026-10-31 执行偏好更新

- 用户已有 Windows 安装：`D:\Program Files (x86)\Tools\Koodo-Reader`，可执行文件版本实测为 2.4.6，资源使用 `resources/app.asar`。
- 已安装包与源码并非相同基线：包内声明的 better-sqlite3 为 `^11.6.0`，源码为 `^13.0.3`，两份 `main.js` 的 SHA256 也不同；版本号相同不足以证明可直接混用资源。
- 后续可考虑备份后替换该目录的构建产物，省去重新生成、运行安装包；不能将源码编辑等同于安装资源已更新。本轮安装目录仅只读检查。
- 不安装任何 Windows 编译组件；Windows 桌面打包由 GitHub 云端完成。
- 当前不需要 Web 构建；Phase 0 跳过 `yarn build`。此偏好不表示 Windows React 渲染资源以后无需编译。
- 不触发云端构建或发布工作流，相关配置本轮只静态检查。
- Windows 实施在 `feature/windows-custom` 分支；目前已有自有同步、Azure 情绪与更新隔离实现，以及无发布云端工作流。所有者已授权本次单独提交、推送该功能分支。详见 [Windows 实施记录](WINDOWS_IMPLEMENTATION.md) 和 [使用说明](WINDOWS_GUIDE.md)。

## 源码基线

| 项目 | 核验结果 |
| --- | --- |
| 工作目录 | `D:\MyProjects\Web_Apps\koodo_reader` |
| 官方仓库 | <https://github.com/koodo-reader/koodo-reader> |
| Fork | <https://github.com/MBT-1111/koodo-reader> |
| HEAD | `42443d83f9a536a3e1c501991ac8b6f635e69bc1` |
| 应用版本 | `package.json`: 2.4.6 |
| 当前分支 | `custom/dev`，跟踪 `origin/custom/dev` |
| 主仓许可证 | 根目录 `LICENSE`：AGPL v3；组件许可须分别核实 |

审计入口：[验收记录](PHASE0_ACCEPTANCE.md)、[待验证事项](AUDIT_STATUS.md)、[架构决定](ARCHITECTURE_DECISIONS.md)、[上游维护](UPSTREAM_POLICY.md)、[阶段计划](PHASE_PLAN.md)。
