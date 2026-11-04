# Android 连续朗读与阅读常亮

后续自动跨章的实现和本地验证范围见 [ANDROID_CHAPTER_SPEECH.md](ANDROID_CHAPTER_SPEECH.md)。本文保留上一批预生成与常亮的真机验收记录。

2026-11-04，分支 `codex/android-phone-prototype`。

## 云朗读预生成

Azure / MiMo 在当前音频实际开始播放后预生成下一段；多角色队列按下一段的角色选择提供器、音色和情绪。沿用原生后台工作线程，不依赖 WebView 定时器。只提前生成一段，缓存保留当前段和下一段，最多两份临时音频。

自然播完或点击“下一段”时复用缓存；下一段仍在请求中时接管同一请求，不重复提交。只有缓存已经准备好才能消除合成等待，播放器切段仍需要解码准备，不保证无缝播放。

暂停时取消未完成的预生成，已完成的缓存保留；明确继续后才重新生成被取消的片段。停止、切书、退出、任务移除及错误仍清理请求和临时音频，迟到结果不能恢复旧会话。取消不能保证服务端停止计费；提前生成的一段也可能因用户停止或跳转而未播放。

预生成失败不打断当前音频。播放到该段时显示原有鉴权、额度或一般错误，不自动重试付费请求。此批结束时尚未接入自动跨章，后续实现见 [ANDROID_CHAPTER_SPEECH.md](ANDROID_CHAPTER_SPEECH.md)；正文跟读翻页及跨进程续播仍未接入。

## 阅读常亮

进入原生 Android 阅读页时开启窗口的 `FLAG_KEEP_SCREEN_ON`，适用于全部阅读格式。正常退出先等待原生关闭常亮，再切回书库；React 卸载也负责关闭。书库和设置页不请求常亮，不修改手机系统的息屏时间。

退到后台时系统允许正常息屏，回到阅读窗口时继续保持常亮。实现依据 [Android 官方屏幕常亮说明](https://developer.android.com/develop/background-work/background-tasks/awake/screen-on)，未增加权限、定时器或第三方依赖。

## 验证入口

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn android:sync
yarn test:android reading.spec.ts reader-ui.spec.ts speech.spec.ts

# 覆盖安装前记录摘要并正常保存当前阅读位置
yarn test:android:screen --baseline
# 安装后验证 EPUB / TXT / PDF、后台恢复、超时和退出清理
yarn test:android:screen
yarn test:android:cloud-speech
yarn test:android:speech
```

屏幕脚本不改变系统息屏时间；已有超时不超过 60 秒时，额外检查超过该时长无输入仍保持亮屏。本机 WebView 调试连接会额外保持屏幕，因此系统窗口和实际息屏检查先断开调试连接，再通过 ADB 核对；检查结束重新连接页面，避免把调试器行为计为应用行为。Samsung 的十六进制窗口标记也按位检查。

云朗读脚本使用本机隔离服务、合成文字和音频，不调用真实云账户。两套脚本在结束后恢复本轮测试开始时的阅读偏好、位置及统计，并核对主库摘要；不会恢复较早的用户配置。

类型检查、188 项 Vitest、13 项相关手机浏览器回归、7 项原生队列单测、Android Lint 与 APK 编译通过。SM-S9110 / Android 16 的云朗读 16 项及屏幕常亮 8 项检查通过，包括提前一段、缓存继续、慢请求接管、停止/暂停迟到结果、预生成失败后延迟报错、多角色提供器路由，以及断开调试后 31.5 秒无输入仍亮屏。三种格式退出均清除常亮，后台不保持屏幕，回到阅读页恢复。

30 项原生存储、导出、凭证及语音协议测试通过。Gradle 的 `connectedDebugAndroidTest` 因离线缓存缺少 UTP 31.13.0 组件未能启动，改用已编译测试 APK，通过 `adb shell am instrument -w xyz.koodoreader.custom.android.test/androidx.test.runner.AndroidJUnitRunner` 执行同一套测试，结果为 `OK (30 tests)`，没有下载依赖。日志为 `continuity-native-tests.log` 和 `continuity-instrumentation.log`。

最终 APK 的系统离线朗读 9 项回归也通过，覆盖选句启动、暂停/跳段/继续、关闭面板、三种音频焦点中断、Home/媒体控制和退出释放。最终 APK 已覆盖安装，实际入口及应用模块与本地构建一致；8 本书、11 条笔记、1 个书签、4 个插件的完整记录摘要与安装前一致，单词表为空。朗读空闲、音频缓存为空，断开调试后的书库窗口不保持屏幕。最终核对见 `dist/android-device/continuity-final-report.json`。

覆盖安装前后主库五张表的记录摘要一致；本轮阅读测试恢复了各自开始时的偏好、位置和统计。安装前偏好摘要与最终检查之间另有启动与测试产生的正常变化，单独记录比较结果，不宣称整个过程所有偏好字节不变。报告位于忽略跟踪的 `dist/android-device/screen-report.json` 和 `cloud-speech-report.json`。

本批未提交、推送或发布；桌面 `custom/dev` 保持不变。
