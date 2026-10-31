# 审计状态

日期：2026-10-31；源码基线 `42443d83f9a536a3e1c501991ac8b6f635e69bc1`。验收结果与命令见 [PHASE0_ACCEPTANCE.md](PHASE0_ACCEPTANCE.md)。

## 证据分级

| 事项 | 当前结论 | 证据与下一步 |
| --- | --- | --- |
| Git/版本/主仓许可 | 本轮核验 | Git 引用、`package.json`、`LICENSE` |
| UI/状态/路由 | 工程配置核验 | React 19、Zustand、react-router-dom v7、Vite、Vitest；根 AGENTS 优先于 `.github/copilot-instructions.md` 中过时的 CRA/Redux 描述 |
| 封闭同步内部实现 | Audit 01 结论保留 | 本轮没有读取禁止的压缩引擎；不得视为可复用的完整同步协议 |
| ConfigService 与绕过 DatabaseService 的写入 | Audit 01 发现待系统盘点 | Phase 1 列出每个实际持久化入口和删除路径 |
| 实体标识 | 设计要求，尚未冻结 schema | 分开 upstream key、同步实体 ID、内容 hash、出版物标识和设备路径 |
| 阅读统计 | 未确认 | ReadingTimeUtil 持久化、schema、累计/合并方式必须实测 |
| 阅读引擎源码 | 本轮不可核验 | AGENTS 指定的 `D:\Project\kookit` 与 `D:\Project\kookit-extra` 均不存在；未转而读取禁止的压缩文件 |
| 官方更新覆盖 | 源码及安装配置核验 | `main.js:update-win-app`、`updateDialog`、`src/utils/request/common.ts`、构建配置和已安装 `app-update.yml` |
| 已安装包与源码关系 | 相同版本号，不同资源基线 | 只读取 ASAR 内的 package.json 并比较 main.js 哈希；better-sqlite3 声明不同。未能从 ASAR 取得该依赖实际 package.json，不能声称已确认实际安装版本或 ABI |
| 默认书库路径 | 源码推导，非用户实际书库配置 | `<userData>/uploads/data`；保存的 `storageLocation` 可覆盖；没有读取真实配置/数据库 |
| 桌面测试隔离 | 方案已记录，完整运行未验证 | 当前单测仅内存构造 Book；没有启动真实应用；完整隔离入口尚未实现 |
| 移动端 | 未选型、未实施 | 公开接口、许可证、桥接、文件/音频/凭证适配需逐项验证 |

## 本轮验证结果

- 锁定依赖首次下载失败：沙箱 DNS `ENOTFOUND registry.yarnpkg.com`；扩大网络权限重试后完成下载和链接，原生构建因缺少 VS 编译环境失败，结束尚在等待的安装进程。没有安装系统编译组件，没有完成项目根 postinstall。
- `yarn typecheck`：退出码 0。
- `yarn test`：退出码 0，1 文件 / 1 测试；仅 Book 模型内存测试。
- Web 构建：用户要求跳过；Windows 本地打包：用户要求转 GitHub 云端，本轮不执行；Electron 真实启动与云端构建均未验证。
- `node --check` 检查 main.js、preload.js、chat-preload.js 通过。业务代码、依赖声明和锁文件未改动。

## Azure-MiMo-TTS-Chrome 参考审计

本地位置：`D:\MyProjects\Extensions\Azure-MiMo-TTS-Chrome`；`manifest.json` 版本 1.1.1。仅只读审计，未改动该项目，未请求真实 Azure/MiMo API。

可借鉴的实现：

- `providers.js:normalizeAzureVoices/stylesFor` 从 Voice List 的每条 `StyleList` 保留能力、去重并补 neutral。
- `reader.js:renderStyles` 只显示当前声音支持的风格，未知风格回退显示服务端代码，切换声音时不保留不支持的旧选择。
- `providers.js:azureSSML/xmlEscape` 生成 SSML 命名空间、动态 locale、文本和属性转义；neutral 不添加 express-as，无效风格回退 neutral。
- `validateSpeed`、`authFor`、`request`、`safeMessage` 提供参数校验、超时、取消、禁止重定向和密钥脱敏思路。

不可直接复制的边界：该扩展只筛中英文；Koodo 应保留已有语言与 Provider。Chrome storage、DOM UI、Blob 音频和播放器不等于 Electron IPC、文件缓存与现有朗读队列。其语速为 0.5–2 倍，Koodo 现有调用单位必须先追踪；情绪、角色、输出格式变化必须反映在音频缓存标识中。中文文案需要接入 Koodo i18n。

Koodo 当前 `azureTTSVoice.js` 丢弃 Voice List 的 `StyleList`，直接插值文本/voiceName 生成 SSML，locale 固定 `en-US`。`ttsUtil.ts` 非官方 Provider 路径直接传 speed，Azure 插件按倍率解释；完整 UI → IPC → Provider 单位契约尚需测试。`ttsCache.js` 目前 hash 整份 config，不能把配置中的凭证作为未来同步或缓存公共元数据。

扩展项目根目录未发现 LICENSE，仅发现 Readability 的 vendor 许可；代码复用前确认自有代码权属/许可。本轮外部仓库 Git 元信息读取受沙箱限制，采用文件 SHA256 定位参考版本：

- `providers.js`: `51FC59CDD612FB06B923A435F36EF48B726592E039A9D7EE3AB126A1729C97E4`
- `catalog.js`: `1C7E1F58B714C340D874039B09D53667FA6A170810042D1FBA4FB21F34228267`

微软官方说明确认 Voice List 返回语音特定的 `StyleList`，SSML 用 `mstts:express-as` 表达风格。上述参考只证明代码存在，不代表已对账户、区域或真实声音做音频验收。[Voice List API](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech)、[SSML 风格与语速](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice)。

## Windows 实施后更新

上表和 Phase 0 验证结果是历史基线。后续授权下已通过隔离的公开 API 执行验证 `readingTime`、`readingStats`，通过 Node 内存 SQLite 验证 SqlStatement 转换和事务 CAS，详见 [数据契约](DATA_CONTRACT.md)。新增协议、Provider、桌面设置、备份恢复、TTS 和更新隔离代码；最终验证见 [Windows 实施记录](WINDOWS_IMPLEMENTATION.md)。

没有解混淆或修改引擎。一次全仓 rg 检索使用了不正确的排除模式，意外返回压缩引擎片段；已更正为明确源码目录与完整排除路径，不将该片段作为审计或实现依据。正常模块导入只用于合成数据的公开 API 测试。

Azure-MiMo-TTS-Chrome 的文件仍未修改。当前 pluginSetting 和 get-tts-voices 的可见实现不要求官方 Pro 即可使用自带 Azure Provider；自定义情绪没有删除授权判断，官方 AI Voice 和多角色分析的现有授权逻辑保留。
