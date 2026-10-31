# Windows 个人服务模式

本轮需求来自所有者的实际 Windows ZIP 测试。源码继续在 feature/windows-custom 修改；所有者已授权提交推送并使用 GitHub 云端打包。本机不执行界面生产构建、不安装 Windows 编译组件，也不改测试应用资源或真实书库。

## 交付范围

| 需求 | 实现与边界 |
| --- | --- |
| Azure 情绪强度 | 每个音色保存 0.01–2 范围内的预设强度；非中性风格启用选择；传入 SSML styledegree，纳入 v3 缓存身份；部分音色可能忽略该参数 |
| 隐藏预载的付费语音 | Custom 的插件可选列表排除 official-ai-*，保留系统语音和用户配置的独立 Provider；旧官方语音选择回退到可用音色 |
| 同步文件增长 | 保留每设备不可变快照及最近 3 代；与远端合并结果一致时不再发布新快照，仍完成本地检查点与恢复流程 |
| 顶部账户、升级 Pro | 在个人构建中隐藏相关 UI，保留上游源码 |
| 设置账户页 | 隐藏导航项；残留账户模式转到自有 AI 配置 |
| 同步与备份 | 个人构建只显示自有云同步模块，旧官方同步定时器和写入入口停用，不清除原凭证或配置 |
| 顶部同步 | 已配置则直接执行自有同步；未配置则打开自有同步设置；错误不转到官方登录 |
| 其他登录入口 | login 路由转回书库；隐藏仍依赖官方服务的元数据、官方 OCR、付费云导入和词形还原入口；原授权判定留在上游分支代码路径 |
| 同书识别 | 完整文件 SHA-256，不用文件名、路径或上游时间戳 key；内容必须字节一致，改内容或重新打包会改变身份 |
| 全文翻译 | 使用 AI 服务中选定的翻译模型，分批发送当前文本；校验结果数量和顺序；缓存按目标语言、端点及模型隔离，不使用官方账号 |
| 生词释义 | 使用词典模型，返回受校验的纯文本释义；匹配原文后交给公开阅读引擎的现有标注接口 |
| AI 多角色 | 使用 AI 辅助模型，只允许返回 narrator/male/female/child；原文由宿主保留，继续复用现有角色音色、朗读和缓存流程 |
| AI 问书 | 隐藏官方 AI 辅助选项，保留用户配置的自有模型；旧官方默认选择重新定位到可用的自有服务 |

## 自有模型配置

复用「设置 → AI 服务」中的 aiModelConfig 与三个模型选择：aiTranslateModel 用于全文翻译，aiDictModel 用于生词释义，aiAssistanceModel 用于问书和多角色分析。角色分析在朗读面板选择音色，不要求官方 Pro。

本轮请求适配使用兼容 OpenAI 的 chat/completions、Bearer API Key 和非流式 JSON 响应，配置沿用现有 AI 服务表单。配置缺失、请求失败或模型格式错误时提示配置/重试，不回退到官方付费接口。API Key 仅随用户端点请求头发送；不进入提示文本、同步数据或缓存身份。端点设置不得指向官方 Koodo 服务。

原文会发送至用户选定模型。模型不得重写角色朗读原文，批量翻译不得漏项；响应格式不符则停止该操作。生词释义只保留公开渲染所需字段，忽略不在原文中的词。全文翻译/生词标注仍需要在 EPUB、TXT 和文本 PDF 的实际阅读窗口验证；扫描书籍受 OCR 能力限制。

## 接口审计依据

公开 kookit 源码审计固定在 c4bfefaa4e601c3eab7c97183a98debe193c2805：[GeneralRender](https://github.com/koodo-reader/kookit/blob/c4bfefaa4e601c3eab7c97183a98debe193c2805/src/renders/GeneralRender.ts) 提供 getBatchTransTexts、handleBatchTransResult 和 handleWordDefinitionResult；[noteUtil](https://github.com/koodo-reader/kookit/blob/c4bfefaa4e601c3eab7c97183a98debe193c2805/src/utils/noteUtil.ts) 使用原文本节点及纯文本属性/提示框展示释义，不增加文字偏移。

调用形状由主仓现有 pageWidget/朗读代码与该公开接口共同核对。没有读取或修改 src/assets/lib 下的压缩实现；公开源码版本不作为内置引擎所有内部行为均已确认的证明。

情绪强度范围、默认值和不支持时忽略的行为见 [Azure SSML 文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice)。

## 更新与测试

个人模式以 src/custom/build.json 的 personalServicesOnly 为开关，新增适配集中在 src/custom。上游授权校验保留；没有将 isAuthed 伪装为 true，也不请求被隐藏的官方阅读服务。隐藏优先于移除官方实现。

自动化新增自有端点选择、批量顺序与格式校验、原文保留、凭证排除、情绪强度/缓存、无变化同步不上传等行为验证。云端冒烟扩展为检查顶部自有同步、账户/升级入口隐藏、只显示自有同步、连续空同步不生成新文件和 login 路由处理。真实 Azure、MEGA 与用户模型调用仍须使用自己的账户人工验收。

提交前本地验证：TypeScript 检查通过，Vitest 8 个文件 / 47 项测试全部通过，新增 JavaScript 语法与变更空白检查通过，101 个中英文 custom 文案键一致。本轮没有执行本机生产构建；新的云端构建与界面冒烟结果以交付提交的 Actions 记录为准。

这些 React/TypeScript 与主进程资源需要重新构建。已打包 ZIP 不会自动热更新；本轮通过推送源码后云端产出新 ZIP 交付，建议独立目录测试。新的 ZIP 使用同一个 Custom profile；不要通过覆盖书库或卸载来更新程序。
