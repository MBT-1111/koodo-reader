# Android 手机原型

2026-11-02：所有者授权开始安卓移植，明确手机优先、没有安卓平板使用场景。本轮启动 Phase 5；沿用现有 React、Zustand 和阅读引擎，使用 Capacitor 8.6 验证 Android 宿主。技术选型仍需真机验证后确认。

## 当前实现

- 原生工程在 `android/`，包名 `xyz.koodoreader.custom.android`，独立于官方 Android 应用及桌面 profile。
- `vite --mode android` 启用手机界面，输出 `build-android/`，桌面仍输出 `build/`。
- 手机书库采用顶部搜索、抽屉导航和底部文件导入；首次启动默认单页、触控、侧栏不固定。
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
2. 目录、书签、触控翻页、旋转及进程重启恢复已验证；继续字体、主题、笔记、高亮和锁屏。
3. 原生返回键已验证；继续全面屏手势、安全区域与软键盘。
4. 原生存储接入后，继续验证大书库、实际空间不足和真实书籍；自定义字体、背景资源及 Android 导出/备份恢复另行适配与验收。
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

自定义字体、背景图片的二进制资源仍使用已有 IndexedDB 路径。配置快照不替代 Android 凭证保管；自有同步、凭证保护和后台朗读仍是后续工作。桥接当前使用 base64 传输书籍，超大文件的内存占用尚未验收。

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

2026-11-02，所有者要求提交推送已验收的本机存储与手机阅读改动，再继续推进。提交目标为 `origin/codex/android-phone-prototype`，不合入桌面分支，不触发发布。下一批继续验证手机字体、主题、笔记和高亮；这些项目不计入本检查点的已验收范围。
