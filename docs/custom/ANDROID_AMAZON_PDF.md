# Android 亚马逊格式与中文文字 PDF

2026-11-04，分支 `codex/android-phone-prototype`。按所有者要求优先补齐常用的 MOBI、AZW、AZW3 和中文文字 PDF，再进入日常使用、边用边修阶段。样本均自行生成，不使用用户书籍或真实云空间。

## 实现范围

- MOBI/AZW/AZW3 沿用已有引擎导入与阅读，普通流式排版接入与 EPUB/TXT 相同的连续章节、正文跟随及普通阅读位置保存。固定版式漫画不启用这条文字朗读链路。
- 原始文字 PDF 复用每页公开的 `getTextContent()` 提取文字，拼接同一行的字形片段并保留 PDF 内容顺序，跳过空白页；沿用准备上限、取消、云音频预生成和多角色下一章分析逻辑，逐页连续朗读。当前页可见文字仍由原阅读接口取得，没有新增 PDF 解析依赖或 OCR。
- 原生进度额外保存 PDF 的零基页索引，网页关闭或进程结束后合入普通 `recordLocation`。重开只定位正文，不恢复音频队列，也不重新发起合成或 AI 请求。
- 复现并修复 PDF 停在第三页、重开落到第四页的问题：下一页部分露出时，原位置可能记录到下一页。现复用漫画适配，按实际可见面积确定当前页，保存一致的页码、索引与比例；前后翻页定位相邻页面。共享工具由 `comicPosition` 更名为 `pagePosition`，已有漫画回归保留。
- PDF 页脚使用同一实际可见页索引，避免正文和保存位置在第三页、页脚却显示第四页。

上述适配使用公开阅读接口及已有 iframe 页面结构，没有读取或修改压缩阅读引擎。云语音继续采用“当前片段播放时预生成下一片段”，没有把同一片段改成网络流式播放。

## 样本

| 文件 | 内容 |
| --- | --- |
| MOBI | 真正的 MOBI 6，两个章节、每章 20 段中文 |
| AZW | 独立标题的无 DRM MOBI 6，以旧式 AZW 扩展名打开 |
| AZW3 | 真正的 KF8 / MOBI 8，两个中文章节 |
| 单栏文字 PDF | 四页中文，嵌入字体子集与文字层 |
| 双栏文字 PDF | 四页左右双栏中文，嵌入字体子集与文字层 |

样本位于 `e2e/android/samples/`，合计约 100 KB；生成器及工具来源见其 [README](../../e2e/android/samples/README.md)。MOBI/AZW 的 PDB 标记为 `BOOKMOBI`、版本为 6，AZW3 的版本为 8。工具保存在忽略目录，没有新增应用依赖，也没有将 EPUB 改名冒充亚马逊格式。

## 本地验收

类型检查、32 个 Vitest 文件中的 223 项测试、12 项原生队列单元测试及 Android lint 通过。新增测试覆盖 PDF 字形拼接、内容顺序、空页、迟到结果取消、原生页码到阅读位置的映射，以及共享可见页适配。

最终生产资源的 22 项浏览器回归通过，覆盖五份新样本、旧五格式、普通阅读、漫画、EPUB/TXT 连续章节、取消及正文跟随。新样本检查实际中文正文、连续朗读输入、跨章/跨页跟随、书签、退出重载和不自动播放；PDF 从第二页开始，核对实际音频输入仍来自第二页。两份 PDF 的文档标题补充为各自的中文名称后另行复核。

模拟原生消息使用实际队列中的原文锚点及章节标题，避免将 MOBI 数字章节标签误写成另一章的标题。此前两轮浏览器测试曾共用输出目录导致一次 trace 文件冲突；最终回归已串行运行并采用独立输出目录，没有把该次失败计为通过。

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn android:sync
yarn test:android amazon-pdf.spec.ts speech-chapters.spec.ts speech-follow.spec.ts reading.spec.ts formats.spec.ts

# SDK/JDK 配置沿用 ANDROID_PROTOTYPE.md，先保存隔离 QA APK
.\android\gradlew.bat -p android --offline --no-daemon -PrestoreQa :app:assembleDebug :app:assembleDebugAndroidTest :app:testDebugUnitTest :app:lintDebug
Copy-Item android/app/build/outputs/apk/debug/app-debug.apk dist/android-device/amazon-pdf-qa-debug.apk
Copy-Item android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk dist/android-device/amazon-pdf-qa-test.apk
# adb/aapt 不在 PATH 时设置 ADB_PATH / AAPT_PATH
node scripts/android-encoding-device.cjs --amazon-pdf
```

## 真机隔离与验收口径

真机使用独立的 `xyz.koodoreader.custom.android.restoreqa` 及其测试包。安装前校验包名、当前用户下没有既有安装、空书库和无真实 MEGA 会话；测试只向 QA 写入合成文件、插件和本机服务配置。Azure、MiMo、AI 分类均由电脑本机服务返回合成响应，不消耗真实云服务额度。系统 TTS 使用手机已安装的离线音色。

整机检查覆盖：36 项原生仪器测试；五种样本的系统文件选择器、持久文档映射、原字节 SHA-256、相邻翻页；五种格式的系统连续朗读与正文跟随；AZW3、双栏 PDF 的 Azure/MiMo 多角色衔接；书签、阅读位置及原文件经进程强制结束后恢复，重开不产生播放或新云请求。结束后仅卸载自有 QA 包，核验内容再删除临时文件；主应用比较五张表、偏好与设备内计算的登录摘要，不回写旧设置。

SM-S9110 / Android 16 的最终 16 项整机检查全部通过，包含 PDF 页脚第三页显示与实际页面一致。最终 QA APK 的 SHA-256 为 `2c262e7907010dc14aea07d18273ae004a9357fc0637fdb5d353d27676f66af9`，与报告、生产资源 `./static/index-m7fkmdIA.js` 一致。此前一次电脑端 ADB 连接超时中断，已按已安装包指纹、文件创建时间和样本内容核验后清理；独立核对主记录、偏好与登录摘要无变化，再完整运行最终验收。

主应用已无损覆盖安装，APK SHA-256 为 `9395c5fd71a5a248ce15a778ba8481c2621b4b134ee3d28eb49a934132989c7f`，已核对设备实际安装包摘要。安装前后 8 本书、11 条批注、1 个书签、0 条生词、4 个插件的记录、阅读位置、统计及 MEGA 登录摘要一致；偏好只有本地 `syncRecord` 启动更新，没有回写旧设置或点击真实云同步。测试包及临时样本已清理，主应用停留书库。

报告保存在忽略跟踪的 `dist/android-device/amazon-pdf-browser-report.json`、`amazon-pdf-device-report.json`、`amazon-pdf-qa-artifact.json`、`amazon-pdf-main-update.json`；ADB 中断恢复核对为 `amazon-pdf-adb-recovery.json`。这一批未提交或推送。

## 验证边界

MOBI/AZW/AZW3 本轮针对无 DRM 的文字书；不包含 KFX 或受 DRM 保护的商店下载文件。PDF 针对有文字层的单栏/双栏中文样本，不包含扫描 OCR、密码、超大文件和任意复杂版式。保留 PDF 内容顺序不能保证所有未标记 PDF 的跨栏阅读顺序都正确。

三个没有封面的亚马逊样本在元数据提取时仍产生被引擎捕获的 `FileReader` / 非 Blob 控制台错误，正文与位置检查不受影响；保留日志，不宣称封面提取已穷尽验证。长时间锁屏、其他机型和其他平台按所有者要求暂缓。正式签名分发仍是后续发布工作，不在本次日常使用准入检查中自动记为完成。
