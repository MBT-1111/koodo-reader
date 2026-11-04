# Android 自动跨章朗读

后续已按所有者要求推进正文跟随、保存阅读位置及多角色原生连续章节；最新行为和验证见 [ANDROID_READING_SPEECH.md](ANDROID_READING_SPEECH.md)。下文保留前一批单音色实现与验收记录。

2026-11-04，分支 `codex/android-phone-prototype`。首轮按用户要求仅完成本地验证；用户随后连接手机并授权测试，本轮已补上下面的真机验收。

## 使用范围

朗读面板新增“自动朗读后续章节”，默认关闭，可保存本机偏好。开启后，从当前可见文字或选句起点开始，依次朗读本章剩余文字及后续章节。

- 支持 EPUB / TXT 的系统语音、Azure、MiMo 单音色朗读。
- 多角色云朗读和其他格式暂不开放该选项，继续保留当前章节行为。多角色仍需逐章分析，不会因本功能一次分析整本书。
- 播放前在本机准备后续章节文字；准备中可停止、切换服务或退出阅读。失败和超限不提交部分队列，可关闭此选项继续朗读本章。
- 原生队列携带章节索引及标题，在句子或片段之间继续到下一章。面板显示当前朗读章节，上一段/下一段也可越过章节边界。
- 阅读视图和已保存的阅读位置保留；本批不做正文跟读翻页，也不把听书位置覆盖到阅读进度。进程结束后不自动续播。

## 实现与约束

复用阅读引擎公开的章节对象：EPUB 用 `createDocument()` 读取独立 XML 文档，TXT 用 `load()` 取得本机 Blob，再解析为惰性文档。没有读取压缩引擎源码，没有切换阅读章节或执行书籍脚本。只提取 body 正文，保留嵌套文本顺序，按块分段；排除脚本、样式、隐藏属性/内联隐藏样式、SVG 及 ruby 注音。样式表驱动的隐藏/显示规则仍需复杂书籍实测。

沿用本书及全局的听书替换/删除规则。输入总文字上限为 200 万 UTF-16 字符，输入段落和原生分段各不超过 2 万条；章节索引递增并受上限约束。超大书籍可关闭跨章，只朗读当前章节。准备阶段仍需要 WebView 运行，准备完成后的队列不依赖 WebView 定时器逐章接续。

后续章节只是本机文本准备，不会一次上传整本书。Azure/MiMo 继续按最多 1200 个 UTF-16 字符合成，禁止把两个章节合并成同一音频片段。沿用上一批的提前一个音频片段、最多两份缓存、取消修订、音频焦点、媒体控制和停止清理。

## 本地验证

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn android:sync
yarn test:android speech-chapters.spec.ts speech.spec.ts reader-ui.spec.ts reading.spec.ts
# 使用本机既有 JDK / SDK / Gradle 缓存
.\android\gradlew.bat -p android --offline --no-daemon :app:testDebugUnitTest :app:lintDebug :app:assembleDebug :app:assembleDebugAndroidTest
```

类型检查、188 项 Vitest、10 项原生队列单测、Android Lint 和调试 APK 编译通过。新增浏览器检查覆盖 EPUB/TXT 后续章节、阅读位置不变、嵌套文字去重、元数据/隐藏文本/脚本排除、准备期间停止/退出、超限后回到本章、PDF 禁用选项；既有多角色检查也验证跨章选项不可用。

生产资源的 18 项相关浏览器回归通过，涵盖新增 5 项跨章检查及既有朗读/阅读交互。最后补齐切书时的准备状态清理后，类型检查及 11 项跨章/朗读复核再次通过，最终 APK 的内置入口文件与本地生产构建一致。本地摘要和 APK 哈希见忽略跟踪的 `dist/android-device/chapter-local-report.json`。

## 真机验收

```powershell
# 覆盖安装前正常保存当前阅读，并仅记录数量与哈希
yarn test:android:chapters --baseline
# 覆盖安装已验证 APK 后
yarn test:android:chapters
yarn test:android:speech
```

SM-S9110 / Android 16 的 8 项跨章检查通过，覆盖 EPUB 系统语音、TXT 系统语音、EPUB Azure、TXT MiMo 四种组合。每组先以真实面板建立队列，在暂停状态定位到章节边界，再恢复播放、回到 Home 并断开 WebView 调试连接 10 秒，重新连接时已进入下一章。云朗读另核对断开期间实际发生了下一章的本机协议合成请求；不使用真实 Azure/MiMo 账号。

同时验证跨章边界的上一段/下一段、无效章节参数不替换原队列、前台暂停继续、后台目标媒体会话控制、阅读位置不变、空章跳过、末章完成及退出后的音频缓存/前台服务/唤醒锁释放。原有系统朗读 9 项真机回归也通过。

当前 APK 的常亮 8 项复核通过：EPUB/TXT/PDF 阅读、后台返回、退出关闭及超过现有 30 秒息屏时间的 31.5 秒无输入检查均通过。最终独立 ADB 核对书库窗口没有常亮标记，朗读空闲且云音频缓存为空；已安装 APK 与验收副本的 SHA-256 一致。汇总见 `dist/android-device/chapter-encoding-final-report.json`。

后台恢复使用媒体会话，应用按钮的暂停恢复在前台操作；测试不把后台直接调用 JS 恢复接口当作用户的通知操作。升级前后主库五张表摘要一致，各轮恢复其开始时的插件、设置、阅读位置和统计；不写回更早的用户配置。结果见忽略跟踪的 `dist/android-device/chapter-device-report.json` 和 `speech-report.json`。

物理熄屏跨章、长时间后台、实际来电/耳机拔出、真实云账号语音及其他机型仍待补充，不能用本次短时 Home 检查替代。

APK 已覆盖安装并保留主应用数据。构建产物位于 `android/app/build/outputs/apk/debug/app-debug.apk`，已验收副本为忽略跟踪的 `dist/android-device/chapter-79ddeda3-debug.apk`。本轮未提交、推送或发布。
