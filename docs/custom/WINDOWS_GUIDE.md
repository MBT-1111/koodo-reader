# Windows 构建与使用

## 当前交付方式

本次交付使用 `feature/windows-custom` 分支。本机不安装 Windows 编译器、不执行 Web 构建、不生成安装包。新增工作流 **Custom Windows verification** 的流程为：类型/测试 → runner 准备 Electron/native → 编译 Windows 所需 React 资源 → 隔离冒烟 → Windows x64 zip。工作流只上传 artifact，不发布 release。

推送后从 Fork 的 **Actions → Build/release → Run workflow** 进入，选择分支 **feature/windows-custom**，再点击运行。默认分支 `dev` 已登记的 `release.yml` 提供手动入口；所选功能分支会调用 `custom-windows.yml`，并跳过官方多平台构建任务。不要为本次自定义构建选择 `dev`。

这个入口避免为登记新工作流而修改干净的默认分支。[GitHub 手动工作流说明](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)要求入口文件存在于默认分支；[本仓库可复用工作流](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows)使用调用者同一提交中的文件。新流程同时保留独立手动入口，未来登记到默认分支后也可直接运行。

运行成功后，打开该次运行的 **Artifacts**，下载 `koodo-reader-custom-windows-<提交 SHA>`，解压外层下载包，再解压其中 `*-Win.zip`，运行 `Koodo Reader Custom.exe`。不要运行仓库中其他上传或 Store 发布流程。

本轮没有触发工作流，因此没有已经通过的 Windows 二进制构建结论。`yarn custom:smoke` 仅在已有 build/index.html、Electron 和 native 依赖的环境执行，创建 krc-test-* 临时 profile，阻断外网/更新/TTS/协议注册并验证设置中的文件夹同步，绝不使用现有书库。

## 数据目录与现有安装

Custom 默认数据目录为 `%APPDATA%\koodo-reader-custom`，默认书库在其中 uploads/data。官方 `%APPDATA%\koodo-reader` 不自动读取、复制或迁移。首次启动 Custom 显示空书库是预期行为。

现有 `D:\Program Files (x86)\Tools\Koodo-Reader` 仍未修改。其版本也是 2.4.6，但主进程与依赖声明不等于当前源码。获得通过云端验证的 zip 后，优先解压到单独目录试运行；如采用原目录增量更新，应退出目标程序并备份整个程序目录，再替换一套匹配的 Electron、app.asar、app.asar.unpacked 及资源。不要只把新 asar 与旧原生模块混用，也不要通过卸载官方应用回滚。

程序回滚恢复旧程序目录；数据回滚使用独立备份，不能把旧程序直接打开已升级数据当作可靠回滚。需要迁入旧书库时，另行准备备份与隔离副本；本轮没有进行迁移。

## 自有同步

1. 在 Custom 的设置 → 同步与备份 → 自有云同步，选择 MEGA 或本地/已挂载文件夹。
2. 各设备使用同一账户、同一同步空间；导入字节一致的书籍。不会上传原文件、路径、封面或插件凭证。
3. MEGA 输入自己的账户与可选两步验证码，连接信息用系统加密保存。后续邮箱和密码留空可保留会话；断开账户不删除远端文件或本地备份。
4. 先关闭全部阅读标签页/窗口，再手动同步。自动同步默认关闭，可设 5/15/30/60 分钟；阅读期间等待，网络失败退避重试。
5. 与其他默认云同步连接互斥，先停用其他默认同步，避免两套协议同时写相同数据。
6. 冲突处保留所有版本，当前暂选版本有标记；选择版本确认解决。删除通常优先，但仍可选择保留版本恢复。
7. 首次历史统计按 max 基线去重，之后合并设备增量。清空本机统计不会复位远端总数。详见 [协议](SYNC_PROTOCOL.md)。

文件夹模式也可用于两份隔离测试 profile 的本地验证。MEGA 的真实账户往返还未验收，不应把单元测试通过视为已验证服务登录和配额。

## 备份与恢复

“打开本地同步备份”定位到 Custom profile/custom-sync；备份包含同步白名单的原始表与配置，以及检查点，不含书籍二进制。

“恢复最近一次同步前的备份”在本机执行，先保存当前数据并暂停自动同步。远端记录仍保留；再次同步可能恢复云端统计。若书籍集合/路径已改变，自动恢复会拒绝替换。遇到“需要恢复”错误时先保留备份，勿删除检查点或反复强制同步。

## Azure 情绪朗读

在插件中配置已有 Microsoft Azure Provider 并重新获取语音列表，再到书籍朗读面板选择音色和情绪。情绪来自该语音的 StyleList，无能力信息时只有中性；未知新风格显示服务端代码。播放停止后可改情绪，预览和正文使用相同参数；同一音色在多个角色间共用情绪。

保留系统语音、其他 Provider、官方 AI Voice 和多角色分析原有逻辑与授权判断。Azure 语速在接入处将阅读队列的百分比转为倍率，不改变其他插件的速度契约。真实语音支持的速度范围、音频缓存、tab/独立窗口暂停恢复仍需实际书籍回归；本轮没有使用真实 API Key 或调用计费接口。

## 正式使用前的人工验收

- 新工作流构建及冒烟成功；确认没有发布 release 或运行安装器。
- 在隔离 profile 导入自己的测试副本，验证 EPUB/PDF/TXT 的 tab 与独立窗口阅读、笔记、书签、关闭落盘。
- MEGA 两设备互通、断网重试、并发冲突/删除、备份恢复；检查云端内容不含路径或凭证。
- Azure 支持/不支持情绪的两种语音、中性、语速、XML 特殊字符、缓存命中、暂停恢复及多角色。
- 确认官方自动更新不能下载/运行安装包，正常上游深链接仍可处理。
