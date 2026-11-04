# Android TXT 编码兼容验收

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

报告位于忽略跟踪的 `dist/android-device/encoding-device-report.json`。这批只证明六份小型合成样本；无 BOM UTF-16、极短/损坏/混合编码文本、Big5 的其他变体及大文件性能仍待单独验收。

本轮未提交、推送或发布。
