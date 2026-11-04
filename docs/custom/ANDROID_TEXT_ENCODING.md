# Android TXT 编码兼容验收

2026-11-04 最新：已补齐无 BOM UTF-16、CRLF 和三份多 MB 中文 TXT 的隔离真机检查，见文末“编码边界与大 TXT 真机补验”。下文保留前期各批次的验证范围；朗读与同步结果见 [ANDROID_READING_SPEECH.md](ANDROID_READING_SPEECH.md)。

2026-11-04，分支 `codex/android-phone-prototype`。自动跨章真机通过后继续补齐 TXT 的非 UTF-8 编码验收。本批新增合成样本、浏览器回归及隔离真机脚本；现有解码路径已通过这些样本，没有增加转换依赖。

## 样本范围

| 编码 | 内容与重点 |
| --- | --- |
| UTF-8 | 简体中文、标点、扩展汉字和 emoji |
| UTF-8 BOM | 同一正文，包含 UTF-8 BOM |
| UTF-16LE BOM | 小端字节序及非 BMP 字符 |
| UTF-16BE BOM | 大端字节序及非 BMP 字符 |
| GB18030 | 简体中文、`𠮷` 和 `🙂` 的四字节编码 |
| Big5 | 繁体正文、章节标题及中文标点 |

每份文件含两个章节，大小约 3.5–5.2 KB。固定 GB18030/Big5 字节片段由标准编码器生成，测试运行仅使用 Buffer；另外以 TextDecoder 检查样本字节与预期正文一致。没有读取压缩引擎源码来判断编码支持，验收依据为实际导入、正文、目录和恢复结果。

## 浏览器与真机结果

```powershell
yarn test:android encoding.spec.ts
# 使用全新、独立的 xyz.koodoreader.custom.android.restoreqa 包
# 将 -PrestoreQa 构建的 APK 保存为 dist/android-device/encoding-qa-debug.apk
# ADB_PATH / AAPT_PATH 可指定 SDK 工具；ANDROID_QA_APK 可指定 QA APK
yarn test:android:encoding
```

6 项生产浏览器回归通过：每种编码均可自动导入、显示两章中文、通过目录跳转及退出重载后恢复第二章。

SM-S9110 / Android 16 的 8 项检查通过：六种编码分别经过实际系统文件选择器、原生持久 URI 映射、正文及目录、重载恢复和原文件 SHA-256 验证；随后强制结束并重启 QA 进程，六份映射、字节指纹与第二章位置均保留。原生检测结果依次为 UTF-8、UTF-8、UTF-16LE、UTF-16BE、GB18030、Big5。

脚本安装前确认当前用户下没有既有 QA 包，并核对 APK 的独立包名；遇到已有包直接退出，仅清理自己成功安装的 QA 包。测试只在隔离包写入合成书；主应用仅比较主库五张表与设置。结束后按用户 0 移除 QA 包，逐份核验字节后删除本轮临时文件。主应用记录与设置保持一致，`syncRecord` 本轮也未变化；没有将旧设置快照写回主应用。

另以本轮临时安装的 QA 包验证拒绝路径：脚本遇到已有包会报错退出，原包仍存在，再由创建者清理；结果记录在 `dist/android-device/encoding-ownership-report.json`。

多 WebView 的 QA 调试切换后曾重复观察到主书库窗口保留常亮标记，尽管主应用本轮未进入阅读页。清理因此在确认仍在书库后显式关闭该测试遗留的窗口标记。独立常亮 8 项回归及无调试器的系统设置往返检查均通过；本批没有据此修改产品逻辑，也没有将手动清理当作退出阅读测试的证据。

选书测试助手补充双向滚动查找，处理系统文件夹记住滚动位置的情况；导入未完成时，助手也会核对并清理自己创建的临时文件，避免失败测试遗留样本。

报告位于忽略跟踪的 `dist/android-device/encoding-device-report.json`。这批只证明六份小型合成样本；当时未覆盖无 BOM UTF-16、极短/损坏/混合编码文本、Big5 的其他变体及大文件性能。后续本地补充见下节。

上述检查点已按所有者要求提交并推送为 `3e020575`，下一批改动继续保留在工作区。

## 无 BOM 与大 TXT 的本地补充

推送后继续验收，实际复现无 BOM 的 UTF-16LE 中文 TXT 被误识别，正文显示乱码。安卓 TXT 导入现增加保守的字节序识别，再通过现有 rendition 的 charset 参数与书籍元数据传递编码；保留原文件字节、指纹和系统文档映射。仅作用于新导入或重新导入的 Android TXT，不批量修改既有条目。

识别只检查前 64 KiB 中对齐的 ASCII/空白与零字节：至少 8 个且占采样单元 10%，另一字节序的证据不超过主序的 10%。随后检查完整输入的偶数字节长度、文本控制字符及代理项配对。已有 BOM、极短、证据不足、混合字节序和损坏输入均交回原有识别；这不是任意无 BOM UTF-16 文件的可靠自动识别承诺。

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn build:android
yarn test:android text-boundaries.spec.ts encoding.spec.ts
```

类型检查、200 项单测及 13 项生产浏览器回归通过。其中新增 12 项编码识别单测、7 项浏览器边界检查：无 BOM UTF-16LE/BE、UTF-8/GB18030 的 CRLF，以及三种多 MB 文本。首次全量单测有一项桌面 profile 测试被沙箱临时目录重命名权限阻止；在正常本机权限下执行同一套 200 项检查全部通过，没有修改该测试或桌面逻辑。

大 TXT 使用每章 35,000 段的两章合成文本。引擎自动拆成编号分块，检查首段、目录跳至末块、后半部中文及退出重载后的块索引恢复；没有要求这类输入仍生成两个原始章节标题。

| 编码 | 文件字节数 | 导入 ms | 首次打开 ms | 跳末块 ms | 重载恢复 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| UTF-8 | 5,332,834 | 1435 | 1054 | 525 | 2657 |
| GB18030 | 3,827,820 | 907 | 882 | 581 | 1745 |
| Big5 | 3,757,820 | 1119 | 1239 | 790 | 3326 |

以上为 Windows Chrome 手机视口的一次观察，不作为手机性能或上限承诺。原始报告及单例用时在 `dist/android-device/text-boundary-browser.json`，构建摘要在 `text-boundary-local-report.json`。更新后的主应用 APK 已编译；本批没有检测到 ADB 手机，没有覆盖安装，也不将本地结果记为真机通过。实际系统选书器、原生持久映射及手机内存表现仍待补充。

## 编码边界与大 TXT 真机补验

返回安卓分支 `codex/android-phone-prototype` 后，在 SM-S9110 / Android 16 完成七份样本的系统选书器导入、中文显示、目录跳转、退出重载和原文件 SHA-256 检查：无 BOM UTF-16LE/BE 两份、CRLF 的 UTF-8/GB18030 两份，以及三份大 TXT。无 BOM 两份均持久保存为对应的 UTF-16LE/BE 编码。

| 大文本编码 | 原始字节数 | 目录跳转后的分块索引 | 进程重启后 |
| --- | ---: | ---: | --- |
| UTF-8 | 5,332,834 | 280 | 分块记录保留，后半部正文可读 |
| GB18030 | 3,827,820 | 280 | 分块记录保留，后半部正文可读 |
| Big5 | 3,757,820 | 280 | 分块记录保留，后半部正文可读 |

完成全部导入后强制结束 QA 进程，再逐本重开七份样本，均能继续访问系统文档、显示后半部中文并保留保存的位置。9 项整机检查、共享样本的 13 项生产浏览器回归、类型检查和 QA APK 编译通过；无页面脚本错误。本轮没有发现需要再修改正文解码逻辑的问题。

浏览器与真机共用 `textBoundaryFixtures()`，新增可重复入口：

```powershell
yarn android:sync
# SDK/JDK 环境沿用 ANDROID_PROTOTYPE.md 中的本机构建配置
.\android\gradlew.bat -p android --offline --no-daemon -PrestoreQa :app:assembleDebug
Copy-Item android/app/build/outputs/apk/debug/app-debug.apk dist/android-device/text-boundary-qa-debug.apk
# adb/aapt 不在 PATH 时，先设置 ADB_PATH / AAPT_PATH
yarn test:android:text-boundaries
```

脚本先核对包名、没有既有 QA 包、空书库和无真实 MEGA 会话，再执行测试；网页请求限制在本机和内嵌资源。主应用只读比较书库记录、设置和设备内计算的登录摘要，不将 MEGA 会话原文传出手机；设置不一致时仅报告摘要。结束后核验样本内容再清理，独立复查确认 QA 包和本轮 TXT 均已移除。主应用五张表、设置及 MEGA 登录摘要一致，本轮 `syncRecord` 也未变化。

验收 APK 摘要为 `64c256fcd5b997b82d525db849a6de7fc02a0c0ce59a9003df885f3a20a6623f`，资源与本轮网页构建一致。报告在忽略跟踪的 `dist/android-device/text-boundary-device-report.json`、`text-boundary-browser-current.json`、`text-boundary-qa-artifact.json`。测试运行在独立 QA 包，未覆盖安装主应用；本轮改动尚未提交。

这些结果覆盖当前手机上的七份合成样本，不代表任意无 BOM、混合/损坏编码或更大文件均可靠。报告中的耗时包含系统选书器、ADB 与触控自动化开销，不作纯解析性能比较，也未测量整机内存上限。
