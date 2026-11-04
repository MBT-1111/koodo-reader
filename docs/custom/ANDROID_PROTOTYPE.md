# Android 手机原型

2026-11-04 最新格式补验：Markdown、HTML、FB2、DOCX、CBZ 已通过真实系统选书器、翻页及进程重启后恢复。修复 Markdown/DOCX 导入筛选遗漏和安卓漫画跳页、位置偏移；216 项单测、10 项浏览器回归及 7 项隔离整机检查通过，新版已覆盖安装，原书库与登录保留。范围与控制台日志限制见 [ANDROID_FORMATS.md](ANDROID_FORMATS.md)。

2026-11-04 最新编码补验：七份无 BOM/CRLF/多 MB TXT 已通过系统选书器、中文正文、目录、进程强制结束后文件访问和阅读位置恢复检查。9 项隔离整机检查及 13 项浏览器回归通过，主书库与登录保持一致，QA 包和样本已清理。详见 [ANDROID_TEXT_ENCODING.md](ANDROID_TEXT_ENCODING.md)。

2026-11-04 后续范围：增加首页手动云同步、停用安卓自动调度；实现 EPUB/TXT 正文随朗读定位、保存普通阅读进度，以及原生多角色逐章分析。真实 MEGA 已在独立测试空间通过双向和部分书库合并，真实空间未混入样本。说明和最新验收见 [ANDROID_READING_SPEECH.md](ANDROID_READING_SPEECH.md)。

2026-11-04 编码边界补充：推送检查点后修复安卓新导入的无 BOM UTF-16 TXT 乱码，补齐 CRLF 与约 3.8–5.3 MB 文本的目录、重载进度验收。200 项单测及 13 项生产浏览器回归通过；本批没有连接手机，新 APK 尚未安装。范围见 [ANDROID_TEXT_ENCODING.md](ANDROID_TEXT_ENCODING.md)。

2026-11-04 TXT 编码补充：UTF-8、UTF-8 BOM、UTF-16LE/BE BOM、GB18030、Big5 的 6 项浏览器及 8 项隔离真机检查通过，含系统选书器、原字节指纹、目录和进程重启恢复；主库与设置保持完整。样本范围见 [ANDROID_TEXT_ENCODING.md](ANDROID_TEXT_ENCODING.md)。

2026-11-04 自动跨章：EPUB/TXT 的系统语音及 Azure/MiMo 单音色已接入原生连续章节队列；随后在 SM-S9110 完成 8 项真机检查，覆盖四组语音/格式组合、断开调试后的 Home 跨章、媒体控制与数据保全。范围及待验收项见 [ANDROID_CHAPTER_SPEECH.md](ANDROID_CHAPTER_SPEECH.md)。

2026-11-04 连续性补充：云朗读在播放当前段时预生成下一段，手机阅读页接入屏幕常亮。行为、取消与验收说明见 [ANDROID_CONTINUITY.md](ANDROID_CONTINUITY.md)。

2026-11-03 阅读统计：参考手机官方 App 的 Settings → Reading stats，在手机设置加入四项概览、7 天柱状/折线趋势与 90 天阅读活动，复用已有阅读记录，支持深色与 E-ink。数据口径和验收见 [ANDROID_STATS.md](ANDROID_STATS.md)。

2026-11-03 手机设置整理：插件页按分类区分已安装与市场，名称/操作分行，页脚回到正常滚动布局，移除手机 About；随后接通选字菜单“从这里朗读”的原生队列起点与一次性自动启动。说明见 [ANDROID_SETTINGS_POLISH.md](ANDROID_SETTINGS_POLISH.md)。

2026-11-03 多角色朗读：手机可用 Gemini AI 辅助模型逐句标记角色，旁白、男声、女声与童声可混用 Azure/MiMo，保留原文、取消分析及原生队列生命周期控制，详见 [ANDROID_MULTIROLE.md](ANDROID_MULTIROLE.md)。

2026-11-03 云朗读：手机插件页与原生播放服务接入用户使用的 Azure、MiMo，支持分段后台生成/播放、Azure 情绪与强度、MiMo 播放语速、缓存位置继续及停止清理。配置方式和测试范围见 [ANDROID_CLOUD_SPEECH.md](ANDROID_CLOUD_SPEECH.md)。

2026-11-03 Gemini / AI 翻译补充：接入 Android 原生 HTTP，增加手机当前页翻译与词义注释面板，补齐 Gemini 选字翻译、模型列表、连接测试和失败恢复。使用方式及验证边界见 [ANDROID_AI.md](ANDROID_AI.md)。

2026-11-03 E-ink 补充：手机书库、设置、阅读工具和正文统一高对比黑白显示，隐藏背景并关闭实际翻页动画，关闭后恢复原有配色与背景。实机已检查三格式阅读、批注、模式重启持久化和书库保全，详见 [ANDROID_EINK.md](ANDROID_EINK.md)。

2026-11-03 更新：按所有者要求，备份统一为跨平台阅读数据 JSON，新导入原书使用系统持久文件映射。本文历史记录中的“完整备份 ZIP”已被替代；当前约定与验证见 [DATA_BACKUP.md](DATA_BACKUP.md)。旧版已存入私有目录的书保持可读。

后续进展：安卓已接入与 Windows v1 协议兼容的 MEGA 数据同步及前台自动调度，说明和隔离验收方式见 [ANDROID_SYNC.md](ANDROID_SYNC.md)。

2026-11-03 继续：新增手机系统 TTS 面板、原生章节队列、媒体通知和前台朗读服务。随后在 SM-S9110 完成实际中文出声、桌面/熄屏续读、通知控制、三种音频焦点中断、结束/退出/重启清理及书库保全验收；8 项可重复朗读回归与 27 项原生测试通过，真实耳机拔出、来电和长时间后台仍待验证。范围与报告见 [ANDROID_SPEECH.md](ANDROID_SPEECH.md)。

2026-11-02：所有者授权开始安卓移植，明确手机优先、没有安卓平板使用场景。本轮启动 Phase 5；沿用现有 React、Zustand 和阅读引擎，使用 Capacitor 8.6 验证 Android 宿主。技术选型仍需真机验证后确认。

## 当前实现

- 原生工程在 `android/`，包名 `xyz.koodoreader.custom.android`，独立于官方 Android 应用及桌面 profile。
- `vite --mode android` 启用手机界面，输出 `build-android/`，桌面仍输出 `build/`。
- 手机书库采用首页/书架/笔记/设置底部导航，顶部导入和搜索；首次启动默认单页、触控、侧栏不固定。
- 阅读使用同一 WebView 内的 HashRouter 路由。关闭时先保存当前位置、停止音频，再返回书库。React 卸载仍负责提交阅读时长。
- 原生返回键先关闭设置/弹出菜单，再退出阅读或收起导航；书库首页返回时将应用放到后台。
- 首轮使用 IndexedDB/localStorage；当前已接入 Android 应用私有文件、原生 SQLite 和配置快照，具体迁移与验收见下文。不读取桌面书库。
- 引擎继续使用已有浏览器宿主接口。实验表明 `isMobile: "yes"` 会启用额外宿主桥接并在 WebView 中报 `postMessage` 错误，因此没有开启这一模式，也没有读取混淆产物。
- 同步、快捷键和桌面本地词典的设置入口在 Android 暂时隐藏。

## 构建和测试

```powershell
# 安装依赖时不运行 Electron 原生模块安装脚本
yarn install --frozen-lockfile --ignore-scripts

# 手机界面浏览器开发
yarn start:android

# 构建手机渲染资源并同步原生工程
yarn android:sync

# 在 Android Studio 中打开工程
yarn android:open

# 检查共享源码
yarn typecheck
yarn test

# 构建后运行隔离的手机浏览器回归
yarn playwright install chromium
yarn test:android

# 已安装 debug APK、连接并授权真机后，运行原生 WebView 回归
yarn test:android:device
# 多台设备时，先通过 ANDROID_SERIAL 指定目标

# 真机多格式阅读：实际选书器多选、中文文件名、手势、书签和旋转
yarn test:android:reading

# 真机字号、主题、长按高亮和系统键盘笔记
yarn test:android:annotations

# 真机字体升级验收（需先用旧 APK 运行下文的字体基线步骤）
yarn test:android:fonts

# 原生存储测试（使用独立测试缓存目录，不打开实际书库）
.\android\gradlew.bat -p android --offline --no-daemon :app:connectedDebugAndroidTest

# 本机已有 Chrome 时，也可用其执行浏览器回归
$env:PLAYWRIGHT_CHROMIUM_CHANNEL = 'chrome'
yarn test:android
```

原生工程的最低系统为 Android 8（API 26），要求 Android System WebView/Chrome 130 或更高，与当前 Vite/PDF 构建目标一致。原生构建使用 SDK 36、JDK 21、Gradle wrapper。Android Studio 需求参见 [Capacitor 环境文档](https://capacitorjs.com/docs/getting-started/environment-setup)。系统栏采用 [SystemBars 的原生安全区域处理](https://capacitorjs.com/docs/config)。

本工程 Gradle wrapper 已改为 `8.14-bin`，复用本机现有缓存。AGP 8.13 的 Gradle 最低要求为 8.13，见 [Android 官方兼容表](https://developer.android.com/build/releases/agp-8-13-0-release-notes)。本机以下命令已完成离线构建，无需另装 Gradle：

```powershell
$env:JAVA_HOME = 'D:\Program Files\IDE\Android\Android Studio\jbr'
$env:ANDROID_HOME = 'D:\Android\AndroidSDK\Sdk'
$env:GRADLE_USER_HOME = 'D:\Android\.gradle'
.\android\gradlew.bat -p android --offline --no-daemon assembleDebug
```

APK 位于 `android/app/build/outputs/apk/debug/app-debug.apk`。上述路径仅记录当前电脑的已验证环境；其他电脑使用其现有 SDK、JDK 和 Gradle 缓存路径。

`.github/workflows/custom-android.yml` 仅支持手动触发。它安装依赖、检查类型和单元测试、构建并同步资源、运行手机浏览器回归，然后编译 debug APK，保存为 Actions artifact；没有发布步骤，不随本次推送自动运行。

2026-11-02，所有者授权提交并推送当前原型，使用独立分支 `codex/android-phone-prototype`。本次不合并到 `custom/dev`。

## 验证边界

本轮本机结果：`yarn typecheck` 通过；15 个 Vitest 文件、116 项测试通过；`yarn build:android` 与 `yarn cap sync android` 通过；手机浏览器回归 2 项通过。已检查书库、阅读和设置截图，截图保存在忽略跟踪的 `test-results/`。构建仍有既有的静态脚本、eval 和大 chunk 提示，不将它们视为原生兼容性验证。

浏览器回归使用 Pixel 5 尺寸、临时浏览器上下文和合成 EPUB，拦截外部网络，验证本地导入、同窗口阅读、翻页、退出、刷新后的书库与进度恢复。它不能证明 Android 文件选择器、原生返回手势或系统后台行为正常。

后续复查确认本机已有 Android SDK 36、Android Studio JDK 21.0.8 与 Gradle 8.14。已用这套环境离线编译，并安装到 SM-S9110（Android 16，WebView 156.0.8078.47）。CI debug 包仍使用临时调试签名，跨次运行可能无法直接覆盖安装；本轮本机覆盖安装沿用本机调试签名，两本合成书及进度保留。

### 本轮真机结果

- `scripts/android-device-smoke.cjs` 的 10 项检查通过：原生启动、返回键关闭设置/导航/阅读、系统选书器打开和取消、合成 EPUB 导入、正文对比度、翻页保存、重新打开恢复、强制结束进程后书库与进度恢复。
- 自动导入使用 WebView 文件输入注入；另外实际操作 Android 系统文件选择器，从 `Download/KoodoReaderCustomTest/` 选中合成 EPUB，确认书库新增 `Android picker fixture`。
- 真机发现缓存中的 `isOSNight` 先于 `initTheme()` 被 Zustand 读取，可能产生黑字深色背景。Android 启动时现按刷新后的主题校正默认阅读背景，保留用户已保存的阅读背景；浏览器回归已加入残留深色标记 + 当前浅色系统的复现样本。
- 最终实体屏幕截图确认正文为黑字白底。WebView 的 CDP 截图有时没有完整包含 iframe 图层，视觉判断使用 ADB 实际屏幕。
- 真机结果保存在忽略跟踪的 `dist/android-device/`：`report.json`、`picker-result.json` 和本地截图。该目录独立于 Playwright 会在启动时清理的 `test-results/`。

这次验收仅覆盖该设备和合成 EPUB；其他格式、大文件、主题切换及长时间使用仍需单独验证。

## 下一批验收

1. 中文文件名的 UTF-8 TXT、PDF 多选已验证；继续大文件、复杂/加密 PDF、其他 TXT 编码。
2. 目录、书签、触控翻页、旋转及进程重启恢复已验证；字号、主题、笔记、高亮与自定义字体的新增验收见下文，继续大型中文字体、其他字体格式与锁屏。
3. 原生返回键已验证；竖屏笔记输入的系统键盘验证见下文，继续其他输入场景、全面屏手势与安全区域。
4. 原生存储接入后，继续验证大书库、实际空间不足和真实书籍；背景资源及 Android 导出/备份恢复另行适配与验收。
5. 独立实现 Android 凭证保管和自有同步宿主适配，复用已验证的同步协议，不复用 Electron safeStorage。
6. 验证 TTS 后台播放、音频焦点、通知媒体控制和前台服务；通过真机原型后再确认长期框架。

未列为通过的项目，尤其自有同步和后台朗读，仍待后续实施与验收。

## Android 本机存储

`KoodoStorage` 是工程内的 Capacitor 插件，没有新增第三方存储依赖。共享 `DatabaseService` 仍以 `database-command` 请求操作，Android 将它路由至插件；Electron 继续使用已有 IPC。原生层只接受允许的分类、操作和值，渲染层不能提交 SQL 或任意文件路径。

- `files/library-v1/book/` 和 `cover/` 保存原书、阅读缓存及封面。写入使用 `AtomicFile`，书籍与封面写完后核对大小和 SHA-256。
- `files/library-v1/records.sqlite` 保存 books、notes、bookmarks、words、plugins。JSON 记录保留共享数据字段；这是 Android 自己的表结构，不直接复用桌面数据库文件。批量迁移按分类使用事务。
- `files/library-v1/preferences.json` 原子保存带版本的设置快照，包含阅读位置和统计。WebView localStorage 保留同步读取缓存；连续修改合并后依次提交至原生，退出阅读和应用生命周期变化时尝试刷新。
- 启动先恢复快照，再加载 React、Zustand 和阅读引擎。缓存缺失时从原生恢复；若缓存版本更新，先补写上次未成功提交的修改。写入失败保留缓存并提示，退出阅读保存失败时留在阅读器内，便于重试。
- 首次升级从既有 IndexedDB 复制书籍、缓存、封面和记录，所有分类及配置写入成功后才视为初始化完成。失败会进入可重试的启动页；原 IndexedDB 始终保留，成功后也没有自动删除。已初始化但配置损坏或缺失时停止启动，不用旧副本覆盖新书库。
- Android 导入始终复制书籍；旧配置中的“直接打开源文件”不会使其跳过复制。

自定义字体和背景图片现已分别接入原生 `font/` 和 `background/`，迁移与验收见下文。配置快照不替代 Android 凭证保管；自有同步、凭证保护和后台朗读仍是后续工作。桥接当前使用 base64 传输书籍，超大文件的内存占用尚未验收。

新增迁移和配置测试覆盖失败重试、写入顺序、缓存恢复及源数据保留。原生仪器测试覆盖 SQLite 重开、分类隔离、迁移事务回滚、路径/操作校验、文件哈希、原子备份恢复、旧版本快照拒绝和损坏配置处理。

### 本机存储验收结果（2026-11-02）

- 类型检查通过，17 个 Vitest 文件、128 项测试通过，其中新增 12 项迁移/配置测试；最终 Android 构建的 2 项手机浏览器回归通过。
- 沿用 Gradle 8.14、SDK 36 和 JDK 21 完成最终 APK 与测试包构建；原生测试首次缺少的 AndroidX 依赖补齐后，最终构建可离线完成。
- 已在 SM-S9110（Android 16）覆盖安装，8 项原生仪器测试通过，测试只使用独立缓存目录。
- 首次升级前记录两本合成 EPUB 的基线；迁移后两本原书 SHA-256、全部分类的记录摘要和阅读位置一致，原 IndexedDB 书库仍保留。其他分类的实际升级样本为空；非空笔记、书签和生词迁移由隔离单元测试覆盖。
- 更新后的 `scripts/android-device-smoke.cjs` 共 12 项检查通过。新增合成 EPUB 及封面已进入原生文件目录，书籍元数据进入 SQLite，退出阅读时位置写入原生快照，强制结束进程再启动后仍可恢复。
- 选书器切换时发现系统焦点会短暂为 null，测试现等待 DocumentsUI/My Files 获得焦点再取消，避免将过渡状态误判成异常。
- 升级摘要、整机报告和截图位于忽略跟踪的 `dist/android-device/`。本轮没有清除实际应用数据，也未提交或推送本轮改动。

写入失败由隔离测试注入；尚未在手机制造实际磁盘满的情况。存储接入时的真机样本为小型合成 EPUB；后续多格式验收见下文。大文件、长时间后台及真实书库规模尚未验收。

## 多格式手机阅读

本批新增合成 UTF-8 TXT、8 页 PDF 和双章节 EPUB，文件名含中文。`e2e/android/reading.spec.ts` 使用隔离浏览器上下文；`scripts/android-reading-device.cjs` 使用已授权手机和原生插件，系统选书器实际选择 TXT/PDF，不清除应用数据。生成器复用已有 JSZip 与项目内 PDFLib，不增加依赖。

- 阅读实例各自管理渲染锁，卸载时清理解锁计时器，避免快速切书时继承旧锁而停在空白页。
- Android 导入不再使用桌面的延迟导航，也不修改正在阅读的书，避免打断阅读。空书库收到第一本书时由书库页面切回列表。
- Android 分页手势在抬手时处理，记录完成后保存位置，避免一次慢速滑动翻多页或画面已翻页但位置未更新。回到起点的取消手势不翻页；桌面原有触控分支保留。
- 阅读面板增加可点击的外部遮罩，Android 返回键优先关闭面板和阅读设置弹窗。操作面板移到手机顶部栏下方，保留工具栏操作；Android 不再使用桌面的悬停自动关闭计时器。
- Android 旋转重排期间保留已保存的位置，防止新布局的页首位置覆盖恢复锚点；已有节流 resize handler 负责重排，没有新增并行监听器。实际翻页仍通过现有位置保存入口更新。
- 目录、书签及笔记列表的主动跳转在 Android 显式记录目标位置，避免与旋转恢复期间的自动记录抑制相互干扰。
- Vite 开发依赖扫描限定为 `index.html`，避免扫描 Android 工程中复制的 HTML/脚本资源并错误解析 PDF.js 的可选 Node 依赖。

选书器脚本区分导航抽屉和工具栏的同名 Downloads 控件，支持此设备的 Select 确认按钮。中文媒体扫描命令经 ASCII 传输后在设备端还原，避免测试工具按字符数编码 ADB 服务消息时截断 UTF-8 命令。这里只适配测试工具；应用通过系统选择器取得文件，没有新增共享存储访问权限。

### 手机阅读验收结果（2026-11-02）

- 最终源码类型检查与默认 `yarn test` 通过：17 个文件、128 项单元测试。中途与浏览器高并发运行时遇到公开引擎导入钩子超时，降低并发及最终单独执行均通过，没有放宽该单元测试钩子的超时。
- 最终生产资源的 6 项手机浏览器回归通过，覆盖从空书库首次导入、中文文件名多选、快速切书、PDF 正文、目录、书签、稳定面板、慢速/取消手势和横竖屏重排。
- 最终 APK 已在 SM-S9110（Android 16）覆盖安装。扩展阅读 10 项及原有冒烟 12 项均通过，报告为 `dist/android-device/reading-report.json` 和 `report.json`。
- 真机实际通过系统选书器同时选择中文 TXT/PDF；三种格式的原生文件 SHA-256 与样本一致。书签在原生 SQLite 中核对；强制结束进程后，EPUB、TXT、PDF 位置及书签恢复通过。
- 旋转测试先离开章节首页，等待旧文档替换，再验证旋转前可见的段落仍在横屏、竖屏的新视口内。重排期间由 Zustand 的临时 reader 状态协调视图和进度面板，避免第二处自动记录覆盖锚点；退出后仍按正常流程刷新原生进度。
- PDF 样本为 8 页西文正文，中文只覆盖文件名和元数据；不将它计为中文嵌入字体或复杂版式 PDF 验收。TXT 是 UTF-8；实际低存储空间、超大文件和长时间使用仍未覆盖。

手机当前保留三本新增样本和原来的三本测试书。测试没有清除应用数据、卸载应用或发布构建。

## 提交检查点

2026-11-02，所有者要求提交推送已验收的本机存储与手机阅读改动，再继续推进。已提交并推送 `794a98a8` 至 `origin/codex/android-phone-prototype`，核对远端提交一致。桌面分支保持不变，没有触发发布。随后继续字号、主题、笔记和高亮适配；后续改动尚未另行提交。

## 手机字号与批注

- 字号滑块使用 Pointer Events 在触屏松手后刷新正文；Android 渲染锁期间的设置刷新进入已有待处理队列，避免连续修改字号和主题时漏掉最后一次设置。
- Android 选字菜单阻止操作按钮抢走 iframe 选区。高亮和笔记仍使用共享引擎的坐标接口，保存至已有原生 SQLite 通道。
- 笔记弹窗按手机视口限制宽高，引用、输入框、颜色、标签与操作按钮采用纵向布局，隐藏桌面的拖动、停靠和快捷键提示。
- 新笔记在输入框聚焦前保存引用位置。Android 编辑笔记期间保留编辑组件，暂缓正文重排，保存或关闭后再处理已有队列；防止键盘引发的重排丢失草稿、清空选区或抢走输入焦点。
- 阅读区域用 `aria-busy` 标记事件绑定与高亮恢复尚未完成的状态，回归测试等阅读就绪后再开始选字。
- 多格式回归发现 TXT 的延迟目录刷新会在退出后重新写入旧阅读实例，导致随后打开的 PDF 记录混入 TXT 位置。Android 卸载视图时取消该计时器，异步渲染和刷新仅允许当前书籍的有效实例更新状态；阅读器与进度面板同时校验书籍 key 后才保存位置。

`e2e/android/annotations.spec.ts` 使用隔离的手机浏览器上下文，测试真实触屏滑块、主题文字与背景、设置刷新恢复、引用高亮、笔记草稿跨视口变化和保存后的批注重绘。`scripts/android-annotations-device.cjs` 使用 ADB 实际长按、点击和系统键盘，核对 SQLite 记录与原生设置快照，并强制结束进程验证恢复。仅操作合成测试书；测试结束恢复原有字号及阅读颜色，不清除应用数据。

真机键盘验收同时检查焦点、窗口尺寸、系统可访问边界和实体屏幕截图，不能只凭 DOM 的“在视口中”判定通过。正文由 CDP 填入中文测试笔记；输入框、选区和保存按钮使用实际触屏操作，未覆盖中文输入法组词过程。

本批结束时，自定义字体文件的原生存储、复杂 PDF 批注、横屏键盘、锁屏及后台朗读尚未列为通过；后续字体适配见下文。

### 本批验收结果（2026-11-02）

- 类型检查通过；17 个 Vitest 文件、128 项单元测试通过。
- 最终生产资源的 9 项手机浏览器回归通过。新增批注测试覆盖触屏字号、深色主题、笔记草稿和重排；新增 TXT → PDF 测试等待旧延迟任务原定触发时间，再核对 PDF 正文与记录。
- 最终 APK 离线编译并覆盖安装至 SM-S9110（Android 16）。真机阅读 10 项、字号与批注 5 项全部通过，报告为 `dist/android-device/reading-report.json` 与 `annotations-report.json`。
- 原生文件校验、目录、书签、单次物理滑动、横竖屏切换、EPUB/TXT/PDF 的进程重启恢复均通过；位置比较没有放宽百分比断言。EPUB 在旋转测试中主动移页，重启参照以旋转后退出时的原生快照为准。
- 真机长按选区、高亮写入 SQLite、系统键盘保持到点击保存、笔记原文与位置、重启后的批注重绘均通过。实体截图确认保存按钮位于键盘上方；该次窗口从 839 CSS 像素缩为 517，弹窗和保存按钮均处于缩小后的视口内。
- 真机书库封面使用 ADB 实际点击并等待原生界面稳定；PDF 正文核对视口内的页面，避免把引擎尚未加载的离屏 iframe 视为渲染失败。章节跳转后等待短暂翻页锁结束，再单独计量慢速滑动的翻页次数。

本批没有新增依赖，也没有清除应用数据。新代码仍在 `codex/android-phone-prototype` 工作区，尚未另行提交或推送。

## Android 自定义字体

字体文件通过已有 `file-command` 接口保存至应用私有目录 `files/library-v1/font/`，沿用 `AtomicFile`、大小和 SHA-256 校验，以及路径/分类校验。`FontUtil` 在原生 Android 上优先读写该目录，不受旧的浏览器本地目录设置影响；Electron 和浏览器沿用已有文件路径。

已初始化书库也会补做一次字体迁移：启动恢复配置后，从旧 IndexedDB 复制 `customFonts` 对应的字体数据，再把完成标记写入原生配置快照。复制失败不发布完成标记，保留源文件供重试；缺失文件的旧条目保留元数据，读取时返回无字体。迁移不清理原 IndexedDB，也不重新迁移已完成的书籍或数据库。

手机字体卡片的删除按钮常驻显示并扩大至 44 像素触控区域。删除正在使用的字体后，清除引用并立即刷新界面/正文；不再继续显示已删除的字体。

### 字体验收结果（2026-11-02）

- 类型检查通过，17 个文件、132 项 Vitest 单元测试通过；完整手机浏览器回归 10 项通过。
- 应用及测试 APK 使用现有工具链离线编译。Gradle 自动连机任务缺少 UTP 的离线缓存，改为 ADB 安装测试 APK、直接启动 AndroidJUnitRunner，9 项原生存储测试通过；测试只操作独立缓存目录。
- 升级前在旧 APK 实际导入中文文件名字体，记录文件哈希与书库 key。覆盖安装后，原生字体文件和旧 IndexedDB 副本哈希一致，原有六本测试书全部保留。
- 真机 5 项字体检查通过：旧字体迁移、系统选书器导入新字体、正文 FontFace 实际加载、界面和正文字体的进程重启恢复、删除当前字体并恢复默认。新导入字体只有原生文件副本，没有创建 IndexedDB 字体副本。
- 测试使用项目自带的 Liberation Sans Bold Italic TTF（135,124 字节）。实体屏幕截图确认西文正文使用该字体，中文由后备字体显示；不将其计为中文字体字形、大型 CJK 字体或 OTF/WOFF 真机验收。
- 测试结束恢复原来的三个字体配置字段，只删除两份测试字体的原生文件与元数据；保留旧 IndexedDB 迁移副本和新增的合成字体测试书。报告及截图在 `dist/android-device/fonts-report.json`、`fonts-instrumentation.log` 和 `fonts-reader.png`。
- 字体触控样式归回组件自身 CSS 后，字体浏览器用例再次通过；重新构建并覆盖安装最终 APK，启动、原书库保留、字体配置恢复和删除后的持久化复核通过，见 `fonts-final-report.json`。

升级验收分两步，必须先在不支持原生字体的旧 APK 中运行 `node scripts/android-fonts-device.cjs --seed-legacy`，再覆盖安装新版并运行 `yarn test:android:fonts`。基线保存在本机忽略跟踪的 `dist/android-device/fonts-before.json`；该脚本使用固定的测试字体名，完整删除验收后不应直接重复运行同一份升级基线。

本批仍未提交或推送，没有新增依赖。背景图片迁移、锁屏、后台朗读及导出/备份仍待后续适配。

## 手机主界面重构第一批（2026-11-02）

用户确认以已安装的官方手机应用为参考后，已实现底部首页、书架、笔记、设置导航，首页继续阅读卡片、常用分类和三列封面网格，以及顶部导入/展开搜索。书架具有独立列表、新建、进入和管理入口；加入书架沿用原有数据逻辑，在 Android 内即时更新路由。笔记、高亮与设置入口已接通，详细页面布局留到第三批。

原生返回先处理搜索、创建表单和书籍/书架弹窗，再返回书架列表及首页。中文搜索的组合事件不再修改阅读锁；通知位置避开顶部入口；导入按钮去掉手机上不需要的桌面悬停遮罩。完整设计和验收记录见 `ANDROID_UI_REDESIGN.md`。

最终类型检查、132 项 Vitest 测试、13 项手机浏览器回归均通过。APK 已覆盖安装至 SM-S9110，原有 12 项冒烟与新增 7 项主界面真机检查通过，包含书架重启持久化及继续阅读的精确进度恢复。保留原有 7 本测试书，删除本轮临时空书架；未清除应用数据，也未另行提交推送。报告和实体首页截图位于 `dist/android-device/ui-report.json`、`ui-home.png`。下一批推进手机阅读工具栏与底部抽屉。

## 手机阅读 UI 第二批（2026-11-02）

默认收起工具栏，短按正文或菜单按钮可呼出顶部退出/书签和底部目录、笔记、书签、主题、设置及进度条。目录、记录和排版复用原有面板逻辑，以 Android 底部抽屉呈现；章节及记录跳转后自动关闭抽屉。系统返回依次关闭抽屉、收起工具、退出并保存。沿用固定正文边距，菜单显隐保持 iframe 视口及正文节点不变；选字和笔记操作期间隐藏阅读工具，避免遮挡键盘上的保存入口。

添加书签与进度跳转仍通过现有 OperationPanel、ProgressPanel 和原生数据通道。阅读实例重新建立时，书签组件先等待有效实例，再绑定新事件并解绑旧事件，避免刷新或恢复后空引用。

最终类型检查、132 项 Vitest 测试、完整 15 项浏览器回归通过。最终 APK 已离线编译并覆盖安装至 SM-S9110；真机冒烟 12 项、新版阅读 12 项、字号和批注 5 项全部通过。覆盖实际轻点、进度条、抽屉和原生返回、单次慢滑、横竖屏锚点、三格式重启恢复，以及真实键盘下的引用保持和笔记保存。测试结束恢复字号和阅读颜色，保留合成样本中的测试批注，没有清除数据或提交推送。详细说明与报告路径见 `ANDROID_UI_REDESIGN.md` 第二批验收。

## 手机设置与全局笔记第三批（2026-11-02）

手机设置改为三组入口和二级页面，复用原设置内容；页面、首页和字体预览分层返回，底部主导航可用。暂未移植的背景图片、导出/备份没有加入新总览，桌面对应页面继续保留。全局笔记和高亮改为单列卡片，提供书籍/多标签与搜索组合筛选、计数、空状态、编辑和书中定位。编辑器适配键盘可用区域，并支持关闭草稿；分页滚动使用公共节流，切换筛选后取消旧异步结果。

最终类型检查、132 项 Vitest 测试和完整 19 项浏览器回归通过。APK 已覆盖安装至 SM-S9110，原有 12 项冒烟和新增 9 项设置/笔记真机检查全部通过，包含原生分层返回、搜索保留、真实键盘保存与取消、SQLite 更新、重启恢复及删除。已清理三条临时记录和临时字体，核对原有笔记内容及 7 本合成测试书保留，并恢复定位测试前的合成书进度。报告为 `dist/android-device/settings-notes-report.json`，实体截图为 `settings-final.png`、`notes-final.png`。本批没有新增依赖、清除数据或提交推送。

## 字体、批注与手机 UI 提交检查点

用户要求将上述已验收改动集中提交并推送一次，再继续安卓适配。本检查点包含原生字体迁移、字号和批注、三批手机 UI，以及相应单元、浏览器和真机回归脚本，目标分支为 `codex/android-phone-prototype`。后续背景资源等适配从该检查点继续。

检查点提交为 `3b6ae0cc`（`feat(android): complete phone UI, annotations and custom fonts`），已推送并核对远端分支。

## 背景图片原生存储与手机页面（2026-11-02）

- 手机设置的阅读分组加入“背景”。复用现有导入、精选图片、应用背景和阅读背景逻辑；手机网格提供常显的 44px 删除按钮，预览操作可触屏使用。系统返回先关闭本地或精选图片预览，再返回设置总览。预览图片根据视口剩余高度缩放，兼容窄屏与横屏。
- Android 的 BackgroundUtil 优先读写应用私有 `files/library-v1/background/`，使用既有原子写入、长度及 SHA-256 校验。新的背景文件不再写入 IndexedDB；图片元数据、列表和选择仍使用原生配置快照。图片数据 URL 校验和 MIME 映射支持 PNG、JPEG、WebP、GIF、BMP、SVG 和 AVIF。
- 背景迁移有独立版本标记 `__koodo_native_backgrounds_version`，已初始化书库也会执行。先复制旧 IndexedDB 图片，全部写入校验成功后再持久化标记；原图片保留，失败可重试，不重跑书籍或字体迁移。
- 手机书库允许根节点背景透出，书籍区域覆盖半透明底色以保持文字可读。阅读页复用背景加载逻辑，独立铺满手机阅读区域，避免被原“隐藏书页装饰”选项挡住；正文 iframe 在选用图片时透明。删除正在使用的图片会清除应用/阅读背景引用和图片配色。
- 新增浏览器背景测试和 `scripts/android-backgrounds-device.cjs`。真机升级测试先在旧 APK 运行 `yarn test:android:backgrounds --seed-legacy`，再覆盖安装新版并运行 `yarn test:android:backgrounds`。测试仅使用程序绘制的 PNG 和既有合成测试书，原书籍和笔记先保存基线并核对。

本批背景改动在该检查点之后，尚未提交或推送，没有新增依赖。系统选图、升级迁移和离线显示的验收使用合成 PNG；在线精选图片下载及超大图片未列为本批通过项目。导出/备份、锁屏和后台朗读继续保留为后续工作。

验收结果：类型检查和 17 个文件的 135 项 Vitest 测试通过；完整 21 项安卓浏览器回归通过，覆盖本地背景、刷新恢复、删除、窄屏/横屏深色预览和返回消费。断网精选缩略图补充占位后，背景 2 项回归再次通过。APK 离线构建并覆盖安装至 SM-S9110（Android 16），背景升级/系统选图/显示/进程恢复/删除等 6 项真机检查、10 项原生存储测试及 12 项既有手机冒烟检查通过。最终安装包另行核对预览按钮与返回、删除后再重启不复现背景，并保留全部 7 本合成书和原有 11 条笔记/高亮。已从新书库删除测试背景，配色已恢复；旧 IndexedDB 迁移源按策略保留，没有清除应用数据。

真机报告为忽略跟踪的 `dist/android-device/backgrounds-report.json` 和 `backgrounds-final-audit.json`；实体截图为 `backgrounds-library.png`、`backgrounds-reader.png`、`backgrounds-settings-final.png`、`backgrounds-preview-final.png`。

## 系统另存为与手机数据导出（2026-11-02）

- 手机设置的书库分组加入“数据”，支持导出全部原书 ZIP、笔记、高亮及查词记录。笔记/高亮沿用 CSV、JSON、Markdown、TXT、HTML、PDF；查词记录沿用 CSV/JSON。通过现有 DatabaseService 的 `database-command` 读取，不增加状态命名空间。
- 共享导出入口改用 `saveExportFile`。Electron 和浏览器继续使用 file-saver；Android 调用工程内 KoodoStorage 的 `saveDocument`，通过 `ACTION_CREATE_DOCUMENT` 让用户选定保存位置。等待输出流写入及关闭成功后才返回成功，取消返回 `cancel`，写入或校验失败返回失败。单本原书的已有导出入口也使用该通道。
- 文件先暂存到应用专用缓存，校验大小、SHA-256、文件名、MIME 和 base64；活动状态中只保存暂存标识及少量元数据，避免把整本书塞入系统活动状态。原生以固定大小缓冲复制文件并校验复制内容，完成/取消后删除本次暂存。异常中断遗留的缓存超过 24 小时会在下一次导出时清理。没有新增存储权限或依赖。
- 手机数据页在导出期间禁用重复操作。空记录提示无内容；取消系统保存不显示成功。原书缺失会阻止生成不完整的 ZIP，同名原书会分配带编号的压缩包条目，保留每份原始内容。
- 新增 `saveExportFile.test.ts`、隔离缓存的 `NativeDocumentExportTest`、`e2e/android/exports.spec.ts` 和 `scripts/android-exports-device.cjs`（`yarn test:android:exports`）。浏览器检查导出文件内容、同名书、缺失原文件、空状态和窄屏；真机使用系统保存页，回读外部文件核对原书哈希、UTF-8 引用/笔记/标签及 PDF 文件头，并核对原有书籍和记录。

本批实现数据导出；全量备份/恢复、后台朗读和锁屏仍待后续适配。与上一批背景改动一起保留在 `codex/android-phone-prototype` 工作区，尚未提交或推送。

验收结果：类型检查、18 个文件的 139 项 Vitest 测试、完整 24 项安卓浏览器回归通过；13 项原生仪器测试通过。最终 APK 已离线编译并覆盖安装到 SM-S9110，12 项既有手机冒烟检查和 7 项导出真机检查通过。系统返回按实际层级关闭键盘、目录和保存页；取消不产生成功提示，本次暂存清理正常。通过系统保存到专用测试目录后，回读核对全部原书 SHA-256、原有笔记/高亮的 key、引用、笔记和标签，以及 PDF 文件头。临时中文查词记录导出后删除，原有书籍、笔记和查词记录逐条一致。测试导出件已清理，手机返回首页，没有清除应用数据。

真机报告与截图分别为忽略跟踪的 `dist/android-device/exports-report.json` 和 `exports-data.png`。本轮使用小型合成 EPUB/TXT/PDF；超大书库、云端文档提供器和保存期间进程被系统终止未列为通过项目。

## Android 完整备份与恢复（2026-11-02）

- 手机“设置 → 数据”增加创建/恢复完整备份。归档保留 books、notes、bookmarks、words、plugins 五类记录、书架/进度等配置，以及 book、cover、font、background 四类文件。配置包含已保存的服务设置和密钥，页面已说明。当前格式用于安卓应用整库恢复，以 `koodo-android-backup.json` 标识类型及版本，原文件逐项记录大小和 SHA-256。
- 创建备份前刷新原生配置，短暂停止配置缓存的写入观察，原生冻结写入后读取一致的记录、配置和文件集合。完成归档后释放冻结和观察器，再使用已有系统另存为通道。原文件缺失或资源元数据无法对应时停止创建，避免生成不完整备份。
- 恢复选择文件后，先检查格式、记录、资源引用、重复键、路径、文件大小和哈希，再显示日期与数量摘要。用户明确确认替换后，原生在 `library-restore/` 重建独立数据库、配置和文件，全部写入校验通过才切换 `library-v1/`。数据库请求仍走 `database-command`；渲染进程不操作 SQLite。
- `NativeLibraryManager` 串行化备份/恢复及普通存储操作，以任务 token 防止串单。切换前写入原子恢复标记，旧库暂存为 `library-previous/`；提交前中断会在下次打开时回滚。成功后删除标记并清理旧库；暂存中断时保留原库。恢复配置的版本高于旧缓存，并设置字体/背景迁移标记，避免旧 IndexedDB 副本覆盖恢复结果。
- 恢复成功后重新加载首页；操作和预览期间阻止重复点击及越级导航。原生返回可关闭恢复预览，系统文件选择器取消不改书库。运行时平台字段和同步日志时间戳会随启动正常刷新。
- 为覆盖测试增加仅构建时启用的 `-PrestoreQa`，生成独立 `xyz.koodoreader.custom.android.restoreqa` 包。它使用独立应用数据目录，真实主应用不执行整库替换。测试结束卸载该测试实例；普通构建仍使用原包名。

验收：类型检查、20 个 Vitest 文件的 149 项测试、原有完整 24 项手机浏览器回归通过。20 项原生仪器测试通过，其中 7 项覆盖快照冻结、完整提交、坏写入、缺失/重复文件与记录、暂存中断和两个目录切换阶段的回滚。

用户提供的真实 EPUB《万历十五年（经典版）》约 8.5 MB 已纳入真机验收。主应用生成的完整备份包含 8 本书、11 个资源文件，ZIP 为 8,589,675 字节，逐项核对与主库文件的哈希一致。主应用 3 项创建/取消检查通过；独立测试实例 6 项检查通过，包含非法文件拒绝、系统选取及预览取消、整库替换、重启持久化、恢复后的真实 EPUB 渲染/翻页，以及主应用原记录和核心配置未被测试改变。没有清除或覆盖主应用书库。

真机回归：先在主应用运行 `yarn test:android:backup --primary`，再构建安装全新 QA 实例并运行 `yarn test:android:backup`。主库恢复操作在脚本中禁止。基线只记录归档文件名、哈希和计数，不记录配置密钥；报告为忽略跟踪的 `dist/android-device/backup-primary-report.json` 和 `backup-restore-report.json`，截图为 `backup-save-dialog.png`、`backup-restore-preview.png`。

本批没有新增依赖或权限，保留完整备份供后续测试。超大书库、真实磁盘满、突然断电和其他机型仍未列为通过。改动与前两批背景/导出一起留在安卓分支，未提交推送；后续继续跨端同步、凭证保管及朗读/锁屏。

## 背景、导出与完整备份提交检查点

所有者要求将这三批已验收的安卓改动集中提交并推送一次，目标仍为 `codex/android-phone-prototype`。本检查点包含背景原生存储与迁移、系统另存为和手机数据页、完整备份/恢复及故障回滚，以及相应单元、浏览器和隔离真机测试。验证结果为类型检查、149 项 Vitest、24 项手机浏览器回归、20 项原生测试和真实书籍备份/隔离恢复检查通过。

完整备份将原书及资源的文件内容写入新的 ZIP，并保存记录和设置。每次创建完整归档，未采用增量或跨备份去重；不会向当前书库新增重复条目。独立迁移记录 `DATA_MIGRATION_2026-11-01.md` 和忽略跟踪的书籍、APK、备份、截图及测试报告不纳入本检查点。
