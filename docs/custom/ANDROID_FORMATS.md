# Android 常见格式兼容验收

2026-11-04，分支 `codex/android-phone-prototype`。在原有 EPUB、PDF 和 TXT 检查之外，补充 Markdown、HTML、FB2、DOCX、CBZ 的基本阅读闭环；继续使用隔离 QA 包与自行生成的样本，不向真实云同步空间写入测试数据。

## 本轮修复

- Markdown、DOCX 已在支持格式列表中，但 MIME 查询没有结果时，导入控件会漏掉对应扩展名。现在补充标准 MIME 回退，复用原有导入路径。
- 安卓漫画在下一页部分露出时，原位置接口可能记录到下一张，翻页也可能跳过一张。现在按阅读区域内占比最大的图片确定当前页，翻页定位相邻图片，保存相同图片的索引、文件名和比例；视图暂时隐藏时保留最后可见位置。适配仅用于安卓 CB 系列阅读器，本轮实际覆盖 CBZ。
- 系统选书测试助手优先点击完整文件名或隐藏扩展名后的名称，避免误点 DocumentsUI 的预览图标。此项是测试自动化调整。

## 样本与结果

| 格式 | 合成内容 | 检查 |
| --- | --- | --- |
| Markdown | 标题及 70 段带唯一编号的中文 | 导入、正文、翻页、同段落恢复 |
| HTML | UTF-8 文档、标题及 70 段中文 | 同上 |
| FB2 | 无封面的简单中文小说 | 同上 |
| DOCX | 最小 OpenXML 文档、标题样式及 70 段中文 | 同上 |
| CBZ | 三张不同颜色的 PNG，ZIP 内文件乱序 | 自然顺序、相邻翻页、恢复到同一张图片 |

类型检查及 31 个 Vitest 文件中的 216 项测试通过，包含漫画位置、可视区域、视图隐藏及相邻翻页检查。最终生产资源的 10 项浏览器回归通过：五项新增格式检查与五项原有阅读交互检查。

SM-S9110 / Android 16 的 7 项整机检查通过：五种文件分别经过真实系统选书器、原生文档映射、正文/图片显示、翻页、退出重载和原始字节 SHA-256 检查；随后强制结束 QA 进程，逐本重开核对原文件与阅读位置；最后清理测试数据并检查主应用。文本恢复按实际可见段落判断，漫画按实际可见图片像素判断，没有仅靠存储字段相等判定成功。

FB2 无封面与漫画封面/图片处理仍产生被引擎捕获的控制台错误（`getAttributeNS` 空值、图片无法解码），但本轮正文、三张漫画显示及恢复检查均通过，无未捕获的页面脚本错误。没有读取或修改压缩引擎；这些日志保留在报告中，不能据此宣称封面处理完全正常。

## 隔离与主应用更新

QA 包为 `xyz.koodoreader.custom.android.restoreqa`。安装前校验独立包名、没有既有 QA 安装、空书库和无真实 MEGA 会话，网页请求只允许本机及内嵌资源；测试结束核验内容后删除自有样本并卸载 QA。主应用五张表、设置及设备内计算的登录摘要在隔离测试前后相同。

通过后已覆盖安装主应用，未卸载或清空主应用数据。8 本书、11 条批注、1 个书签、0 条生词、4 个插件，以及阅读位置、统计和登录摘要与安装前一致。偏好变化已逐项核对：`readerConfig` 仅系统主题标记 `isOSNight` 从 `yes` 刷新为 `no`，另有启动时的 `syncRecord` 更新；其余偏好摘要相同。通过重建候选 JSON 并匹配安装前 SHA-256，确认主题标记是整份 `readerConfig` 的唯一变化，没有回写旧设置。

主应用 APK SHA-256：`1f94990ec22c420a8ce8cf228e2542ebb842faf013d3de801695b8879689fc52`。QA APK SHA-256：`52d2282fc9c4dd79b295b859f44334d668b1752234ee9f2180ce389bab2ea61a`。二者网页入口均为 `./static/index-Bf0Smkou.js`，已核对已安装 APK 与候选包摘要相同。构建、报告和安装前 APK 保存在忽略跟踪的 `dist/android-device/`，主要报告为 `formats-browser-report.json`、`formats-device-report.json`、`formats-qa-artifact.json`、`formats-main-update.json`。

## 重复验证

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn android:sync
yarn test:android formats.spec.ts reading.spec.ts

# SDK/JDK 配置沿用 ANDROID_PROTOTYPE.md；先保留独立 QA 包
.\android\gradlew.bat -p android --offline --no-daemon -PrestoreQa :app:assembleDebug
Copy-Item android/app/build/outputs/apk/debug/app-debug.apk dist/android-device/formats-qa-debug.apk
# adb/aapt 不在 PATH 时设置 ADB_PATH / AAPT_PATH
node scripts/android-encoding-device.cjs --formats
```

本轮覆盖五份简单合成文件，不代表复杂 DOCX 排版、带资源的 HTML、任意 FB2、超大漫画或 CBR/CB7 等归档均已验证。MOBI/AZW3、复杂 PDF 和其他格式继续按常见文件逐步验收，不在单一格式上追求穷尽。长时间锁屏、其他机型和其他平台仍按所有者要求暂缓；当前安装为 debug 构建，尚未完成正式签名分发。
