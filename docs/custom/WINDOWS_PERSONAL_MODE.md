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
| 当前页翻译 | 使用 AI 服务中选定的翻译模型，仅请求当前视口内可见段落；跨页段落保留完整以兼容段落替换；每次最多 6000 字符 / 64 段，翻页取消旧请求，已完成译文按语言、端点及模型缓存 |
| 生词释义 | 使用词典模型，返回受校验的纯文本释义；匹配原文后交给公开阅读引擎的现有标注接口 |
| AI 多角色 | 使用 AI 辅助模型，只允许返回 narrator/male/female/child；原文由宿主保留，继续复用现有角色音色、朗读和缓存流程 |
| AI 问书 | 隐藏官方 AI 辅助选项，保留用户配置的自有模型；旧官方默认选择重新定位到可用的自有服务 |

## 自有模型配置

复用「设置 → AI 服务」中的 aiModelConfig 与三个模型选择：aiTranslateModel 用于全文翻译，aiDictModel 用于生词释义，aiAssistanceModel 用于问书和多角色分析。角色分析在朗读面板选择音色，不要求官方 Pro。

本轮请求适配支持 OpenAI 兼容 chat/completions 与 Gemini 原生 generateContent，配置沿用现有 AI 服务表单。兼容接口使用 Bearer API Key / response_format=json_object；Gemini 原生使用 x-goog-api-key / generationConfig.responseMimeType=application/json。提示中给出 texts / words / roles 对象示例，角色优先使用输入 id 到角色的映射，兼容旧数组及 sentences 角色对象，并始终从本机原文生成朗读内容。在官方 DeepSeek 域名关闭思考模式；其他服务不附加该专有参数。配置缺失、请求失败或模型格式错误时提示配置/重试，不回退到官方付费接口。API Key 仅随用户端点请求头发送；不进入提示文本、同步数据或缓存身份。端点设置不得指向官方 Koodo 服务。

原文会发送至用户选定模型。模型不得重写角色朗读原文，批量翻译不得漏项；响应格式不符则停止该操作。生词释义只保留公开渲染所需字段，忽略不在原文中的词。全文翻译/生词标注仍需要在 EPUB、TXT 和文本 PDF 的实际阅读窗口验证；扫描书籍受 OCR 能力限制。

## 接口审计依据

公开 kookit 源码审计固定在 c4bfefaa4e601c3eab7c97183a98debe193c2805：[GeneralRender](https://github.com/koodo-reader/kookit/blob/c4bfefaa4e601c3eab7c97183a98debe193c2805/src/renders/GeneralRender.ts) 提供 getBatchTransTexts、handleBatchTransResult 和 handleWordDefinitionResult；[noteUtil](https://github.com/koodo-reader/kookit/blob/c4bfefaa4e601c3eab7c97183a98debe193c2805/src/utils/noteUtil.ts) 使用原文本节点及纯文本属性/提示框展示释义，不增加文字偏移。

调用形状由主仓现有 pageWidget/朗读代码与该公开接口共同核对。没有读取或修改 src/assets/lib 下的压缩实现；公开源码版本不作为内置引擎所有内部行为均已确认的证明。

情绪强度范围、默认值和不支持时忽略的行为见 [Azure SSML 文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/speech-synthesis-markup-voice)。

DeepSeek 格式依据为官方 [JSON Output](https://api-docs.deepseek.com/guides/json_mode/) 和 [Thinking Mode](https://api-docs.deepseek.com/guides/thinking_mode/)。空白或被截断的答案单独提示，不自动重复付费请求。上述 kookit 提交的 [navigationUtil](https://github.com/koodo-reader/kookit/blob/c4bfefaa4e601c3eab7c97183a98debe193c2805/src/utils/navigationUtil.ts) 中，audioText 从可见处取到章节后文，visibleText 仅取视口内容；原 getBatchTransTexts 对章节后文截取约 10000 字符。新的适配以 visibleText 选择段落，使用完整原段落作为渲染键，避免仅翻片段却隐藏整段原文。

## 更新与测试

个人模式以 src/custom/build.json 的 personalServicesOnly 为开关，新增适配集中在 src/custom。上游授权校验保留；没有将 isAuthed 伪装为 true，也不请求被隐藏的官方阅读服务。隐藏优先于移除官方实现。

自动化新增自有端点选择、批量顺序与格式校验、原文保留、凭证排除、情绪强度/缓存、无变化同步不上传等行为验证。云端冒烟扩展为检查顶部自有同步、账户/升级入口隐藏、只显示自有同步、连续空同步不生成新文件和 login 路由处理。真实 Azure、MEGA 与用户模型调用仍须使用自己的账户人工验收。

提交前本地验证：TypeScript 检查通过，Vitest 8 个文件 / 47 项测试全部通过，新增 JavaScript 语法与变更空白检查通过，101 个中英文 custom 文案键一致。本轮没有执行本机生产构建；新的云端构建与界面冒烟结果以交付提交的 Actions 记录为准。

云端冒烟后续修复：header-report-container 同时用于 TEST 环境标识和 Pro 推广，按该样式类计数会误报。改为精确匹配升级、续费、试用的英文/简中文案并允许首尾空白，保留原推广隐藏断言。已在本地隔离的无头浏览器中复现原误报，并验证 TEST 排除及六种推广文案识别；脚本语法检查通过。此次不修改产品代码，完整 Electron 冒烟由所有者在后续云端构建验证。

2026-11-01 阅读反馈修复：上述 JSON 模式和当前页范围已接入；翻译整个操作最多等待 60 秒，失败/结束后清理转圈标识；停止朗读、退出面板会取消角色分析并停止后续批次。网络取消不能保证服务端撤回已经处理的计费。朗读控制栏去掉左侧重复的停止键，保留上一句、播放/暂停、下一句、停止。本地类型检查通过，9 个测试文件 / 56 项测试通过，包括包装角色、原文保留、空白/截断输出、取消后不再请求、视口外文本排除、跨页段落和请求量上限；105 个中英文 custom 文案键一致。真实 DeepSeek 返回、翻页缓存和 EPUB/TXT/PDF 界面仍需新云端包人工验证，不声称已完成账户实测。

### 2026-11-01 本机多角色实际验证

所有者授权在已打开的 99741dfa 软件及其现有模型配置中直接测试。正常重启后临时启用本机调试，实际复现 deepseek-flash 首批 8 条输入只返回 7 个角色；返回本身是合法 JSON，首条输入是章节编号“1”。此前只处理 JSON 形状，没有覆盖模型省略非句子内容的情况。

修复将纯数字、标点等无字母文本直接保留为旁白，其余输入附加明确 id，请求 roles 对象逐 id 返回。可定位的缺失 id 使用旁白并提示漏判数量，不追加模型请求；陌生 id、非法角色及无法可靠定位的旧数组缺项仍拒绝。编号在本地重新合并，原文和原索引始终保留；取消及原始文本量限制在过滤前检查。

真实验证使用相同失败输入：仅向模型发送 7 条正文，得到完整 id 映射，最终保留 8 条原始文本，回退数为 0。将实际修复函数转译后临时接入当前阅读窗口的请求边界，继续验证 DeepSeek + MiMo 链路：350 条文本 / 44 批全部对齐，回退 0、格式错误 0，播放进度到第 4 条文本后主动停止。这个测试没有替换安装文件，也没有执行本机生产构建；测试适配和调试启动随后清理，软件正常重开。永久修复需要新的云端包。

本次补充回归后 TypeScript 检查与 9 个文件 / 60 项测试通过，中英文 custom 文案键 106 个一致。该实测证明当前书籍和配置的多角色链路通过，不代表其他服务、书籍格式、翻译分页及全部角色声音均已人工覆盖。接口诊断日志仅保留数量和状态，没有保存认证头、API Key 或请求/响应正文；操作定位截图和诊断脚本留在本机忽略目录，不纳入 Git 提交。

### 生词水平与 Gemini 补充

三个模型选择相互独立：aiTranslateModel 负责当前页翻译，aiDictModel 负责生词释义，aiAssistanceModel 负责多角色分析与已有辅助用途；真正发声继续使用朗读面板选择的 MiMo、Azure 等 Provider。换模型配置无需重新编译，但服务须符合对应协议并能生成所需 JSON 结构。

英语生词水平作为基础水平发送给词典模型，挑选高于该水平的词，通常低水平标注更多、高水平标注更少；这是 AI 估计，不是固定考试词表。2026-11-01 在用户 ba9bab4d 软件、现有 deepseek-flash 词典及六级设置中复现：8 段输入被合并成 1 组 20 个词，旧代码按逐段数量验证失败。修复优先要求段落 id 映射；兼容实际出现的合并/扁平词表，按词项在原文中的出现重新分配，只保留已知纯文本字段；空词表、缺失组保留原文及空释义。每段最多 8 个词，减少输出截断与请求量，不额外请求来修补分组。

真实回放与新请求均保留了 8 段原文。临时接入修复函数的阅读界面实测：100 段 / 13 批全部对齐，生成 195 处非空释义标注，格式错误 0；这验证了词典模型到阅读引擎的实际显示链路。词义准确性及词汇难度仍由模型决定。

Gemini 地址支持两种：兼容地址 https://generativelanguage.googleapis.com/v1beta/openai，以及 Google/Gemini Provider 的原生根地址 https://generativelanguage.googleapis.com/v1beta。带 models/ 的模型名会规范化，配置页测试和获取模型列表共用协议适配。第三方代理的自定义 OpenAI 模型不会仅因名字含 Gemini 就被强制切换协议。接口依据为官方 [generateContent 文本生成](https://ai.google.dev/gemini-api/docs/generate-content/text-generation)、[结构化输出](https://ai.google.dev/gemini-api/docs/generate-content/structured-output) 与 [API 鉴权](https://ai.google.dev/api)。

使用用户已保存的 models/gemini-3.5-flash，在不修改保存配置的前提下以短合成文本实测：兼容模式的多角色、翻译、生词三项通过；原生及兼容模型列表分别返回 HTTP 200，原生短 JSON 调用也通过。完整原生阅读调用遇到服务方 HTTP 503“high demand”，未取得原生三个阅读功能全部成功的结论。429/503 单独提示服务繁忙或受限，不再混作格式错误，也不自动重试。此轮 Gemini 验证范围为上述阅读工具及配置协议，未覆盖其他 AI 面板的原生接口行为。

本轮 TypeScript 检查及 10 个文件 / 75 项测试通过，中英文 custom 文案键 108 个一致。临时适配和模型覆盖值已清除，软件以无调试参数正常重开；没有替换安装文件或执行本机生产构建。需要新云端包使修复持久生效。

这些 React/TypeScript 与主进程资源需要重新构建。已打包 ZIP 不会自动热更新；本轮通过推送源码后云端产出新 ZIP 交付，建议独立目录测试。新的 ZIP 使用同一个 Custom profile；不要通过覆盖书库或卸载来更新程序。
