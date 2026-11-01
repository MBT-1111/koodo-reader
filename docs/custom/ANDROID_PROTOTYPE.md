# Android 手机原型

2026-11-02：所有者授权开始安卓移植，明确手机优先、没有安卓平板使用场景。本轮启动 Phase 5；沿用现有 React、Zustand 和阅读引擎，使用 Capacitor 8.6 验证 Android 宿主。技术选型仍需真机验证后确认。

## 当前实现

- 原生工程在 `android/`，包名 `xyz.koodoreader.custom.android`，独立于官方 Android 应用及桌面 profile。
- `vite --mode android` 启用手机界面，输出 `build-android/`，桌面仍输出 `build/`。
- 手机书库采用顶部搜索、抽屉导航和底部文件导入；首次启动默认单页、触控、侧栏不固定。
- 阅读使用同一 WebView 内的 HashRouter 路由。关闭时先保存当前位置、停止音频，再返回书库。React 卸载仍负责提交阅读时长。
- 原生返回键先关闭设置/弹出菜单，再退出阅读或收起导航；书库首页返回时将应用放到后台。
- 首轮暂用既有 IndexedDB/localStorage 存储；不实现 Android SQLite，不伪造 Electron IPC，不读取桌面书库。
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

1. 扩展系统文件选择器验收：TXT、PDF、多文件、大文件及中文文件名。
2. 验证点击/滑动翻页、目录、字体与主题、笔记、高亮和进度；旋转、锁屏和进程被杀后恢复。
3. 验证原生返回键、全面屏手势、安全区域与软键盘。
4. 将书籍/封面与必要配置迁入应用私有存储，验证持久化、空间不足和恢复，再接真实书库。
5. 独立实现 Android 凭证保管和自有同步宿主适配，复用已验证的同步协议，不复用 Electron safeStorage。
6. 验证 TTS 后台播放、音频焦点、通知媒体控制和前台服务；通过真机原型后再确认长期框架。

未列为通过的项目，尤其原生存储、自有同步和后台朗读，仍待后续实施与验收。
