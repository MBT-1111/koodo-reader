# Android 系统朗读原型

后续已接入手机 Azure / MiMo 云朗读，详见 [ANDROID_CLOUD_SPEECH.md](ANDROID_CLOUD_SPEECH.md)。本文保留系统语音批次的历史范围与验收记录。

阅读工具栏的扬声器按钮打开手机朗读面板。音色来自设备的默认 TTS 引擎，支持选择音色、0.5–3 倍语速、暂停/继续、上一句、下一句和停止。没有安装语音时提示到安卓系统设置添加；需要联网的音色单独标记。普通浏览器预览只显示原生能力说明。

本批先验证原生音频宿主：复用阅读引擎的 `audioText()` / `visibleText()`，从当前可见文本排队到当前章节末尾，应用本书及全局的文本替换/删除规则。队列独立于 WebView 的计时器运行；关闭面板保留播放，退出阅读器、切书或从最近任务中移除应用时停止。系统 TTS 没有暂停接口，继续会重读当前句。

自动跨章、正文跟读高亮/翻页、朗读位置持久化、Azure 等自定义提供器、多角色及情绪语音尚未接入此原型。朗读不改写当前阅读位置；进程被系统终止后不自动恢复或播放旧文本。

## 原生宿主

- `KoodoSpeech` 是工程内的 Capacitor 插件，所有命令在主线程串行执行。队列通过应用内 Binder 传递，不把章节文本放入 Intent 或持久化文件；不执行脚本、SQL 或任意路径操作。
- `NativeSpeechService` 使用 Android `TextToSpeech`、`MediaSession` 和 `mediaPlayback` 前台服务。系统通知提供上一句、暂停/继续、停止，并可返回应用；媒体会话同时提供下一句控制。应用不请求普通通知权限，媒体通知使用系统的媒体会话豁免。
- 播放前先建立前台服务，再请求语音媒体音频焦点。失去焦点（包括要求降低音量）、拔出音频设备时暂停，不自动抢回播放。播放时持有有界限的 CPU 唤醒锁，切句时续期，暂停/结束/失败释放。
- 章节输入限制为 200 万 UTF-16 字符和 2 万段，原生按句子和引擎长度限制拆分，不截断代理对。每个队列及每次继续/切句使用独立标记，忽略暂停、停止、旧句和旧书的延迟回调。
- 通知动作使用不可变 PendingIntent；服务不向其他应用导出。原生通知有英文和简体中文资源；React 文本使用既有 i18n。没有新增依赖。

参考：[TextToSpeech](https://developer.android.com/reference/android/speech/tts/TextToSpeech)、[媒体播放前台服务](https://developer.android.com/develop/background-work/services/fgs/service-types#media)、[音频焦点](https://developer.android.com/media/optimize/audio-focus)、[媒体通知权限豁免](https://developer.android.com/develop/ui/views/notifications/notification-permission#exemptions-media-sessions)。

## 验证与待验收

单元测试：`yarn test --maxWorkers=2`；原生队列：`android/gradlew.bat -p android --offline --no-daemon :app:testDebugUnitTest`；界面：构建后运行 `yarn test:android speech.spec.ts`。界面测试使用隔离浏览器书库及模拟 Capacitor 语音桥，不能证明系统语音实际出声或锁屏播放正常。

首次构建时没有连接设备。以下为完整验收清单，同日真机覆盖的项目见下文：

1. 默认/中文音色实际出声，语速改变、长文本拆句、暂停后重读当前句。
2. 关闭面板、切到桌面和锁屏后继续，通知及媒体按钮暂停/继续/切句/停止。
3. 其他播放器或来电抢占焦点、拔出耳机后暂停且不自动恢复。
4. 退出阅读、快速切书、划掉应用后无残留音频、通知或唤醒锁。
5. 本章结束停止；强制结束进程后无旧队列自动播放；原有书库和阅读位置不变。

真实耳机拔出、实际来电、长时间后台及其他设备仍需后续验收。

2026-11-03 首轮本机结果：类型检查通过；23 个 Vitest 文件的 165 项测试、4 项原生队列单元测试、Android lint、完整 28 项手机浏览器回归通过。已同步最终资源并离线构建 debug APK，位于 `android/app/build/outputs/apk/debug/app-debug.apk`。新增浏览器测试覆盖唯一面板、返回/反复开关、播放/暂停/切句、关闭面板保留播放、退出停止、失败重试及无可用音色；音频由模拟桥提供，不计为实际语音引擎验收。当时尚未安装到设备，未提交或推送。

## 同日真机验收

用户连接 SM-S9110（Android 16）后，已无损覆盖安装并完成实际播放。三星默认语音引擎限制第三方应用绑定，系统自动选用公共 Google TTS 引擎；本轮使用 `cmn-cn-x-ccc-local` 中文离线音色，用户确认能听到中文朗读，没有修改系统默认语音或音量。

- `yarn test:android:speech` 的 8 项检查通过：实体点击开始、原生句子完成推进、实体暂停/继续/切句、关闭面板保持播放、独立 UID 的 duck/transient/gain 三种音频焦点中断、返回桌面后的媒体控制，以及退出时释放前台服务和唤醒锁。中断后不自动恢复，手动继续才重新获取焦点。
- 另外完成 12 项现场检查，涵盖升级数据核对、用户出声确认、熄屏队列推进、锁屏媒体暂停/继续、实体通知栏暂停/下一句/继续/停止、短队列实际播放结束、播放期间强制结束进程及重启后不恢复旧队列。锁屏样本在一次 12 秒观察中从第 27 句推进到第 30 句；不计为长时间后台压力验收。
- 真机发现 Android 13+ 的媒体卡片根据 `PlaybackState` 重建按钮，原通知中的停止按钮没有显示。现在通过媒体会话的 custom action 提供停止；Android 16 实体点击停止后队列清空、通知卡片消失，短队列完成后前台服务和唤醒锁均释放。机制见 [Android 官方说明](https://developer.android.com/about/versions/13/behavior-changes-13#media-controls)。
- 最终原生代码的 Android lint、4 项队列单元测试及 APK 编译通过；手机上的 27 项隔离存储/凭证测试通过。本机 Gradle 离线 UTP 调度依赖缺失，使用同一测试 APK 的 `adb shell am instrument -w -r xyz.koodoreader.custom.android.test/androidx.test.runner.AndroidJUnitRunner` 执行，结果为 `OK (27 tests)`。
- 主库 8 本书、11 条笔记/高亮、1 个书签及空的查词/插件表，最终逐表摘要与升级前一致。测试书位置、阅读时长/统计、最近阅读及朗读音色/语速已恢复；最终进程重启后再核对原生快照。没有清除应用数据、卸载主应用、提交或推送，手机留在书库首页。

报告在忽略跟踪的 `dist/android-device/`：`speech-report.json`（8 项可重复回归）、`speech-manual-report.json`（12 项现场检查）、`speech-baseline.json`、`speech-library-final.json`。实体截图为 `speech-playing.png`、`speech-notification-final.png` 和 `speech-final.png`。

回归脚本要求手机解锁、当前为英文 UI、书库保留既有合成《安卓章节样本》，并先构建安装主 APK 与 `:app:assembleDebugAndroidTest` 生成的测试 APK。`SpeechFocusProbeActivity` 只存在于测试包，使用独立 UID 请求真实系统音频焦点，不播放声音、不读取书库；每轮删除自身旧结果后再检查新请求。默认回归不锁屏；加 `--screen-off` 才运行熄屏步骤，唤醒后需要手动解锁继续。

## 提交检查点

2026-11-03，用户要求将本批已验收的系统朗读、媒体通知、音频焦点处理、回归脚本和文档集中提交并推送到 `codex/android-phone-prototype`。本次检查点不包含 APK、真实书籍、设备截图或本机验收报告；未合并至桌面分支。当前章节范围及尚未覆盖的真实来电、耳机拔出和长时间后台验收继续保留。
