# Android PDF 触摸翻页修复

2026-11-05，分支 `codex/android-phone-prototype`。处理图片 PDF 上拖动出现桌面框选、滑动无法翻页的问题。

## 原因与修改

- 原始 PDF 未设置独立阅读模式时沿用桌面的 `scroll` 回退，原有分页手势会直接跳过。安卓原始 PDF 现在默认使用单页模式，不写入或覆盖已有的 `pdfReaderMode`；已主动选择滚动模式的用户仍保留该选择。
- 图片 PDF 的 Fabric 选区画布在未开启批注时仍覆盖正文，画布的 `touch-action: none` 阻止原生滑动。复用已有 iframe 样式注入和批注状态 effect，普通阅读时让该层不接收触摸；开启批注时撤销覆盖，恢复画布输入。
- 安卓原始 PDF 向公开引擎接口传入移动模式。这个选项仅针对原始 PDF，其他格式与桌面的参数保持原有行为。
- 分页 PDF 的现有 Hammer 手势绑定到实际 HTML 根元素，启用四方向识别，以结束手势时的方向翻一页。左/上滑下一页，右/下滑上一页；保留多指手势过滤与原有进度保存。根元素允许 `pinch-zoom`，批注开启时跳过分页手势。

没有读取或修改压缩引擎，也没有新增解析依赖、数据库字段或同步协议。

## 回归样本与隔离

新增八页纯图片 PDF 生成器，文字和页号均绘制在 PNG 内，PDF 本身没有文字层；文字 PDF 复用现有嵌入中文字体的单栏样本。浏览器使用真实 CDP 触摸序列，验证四方向逐页、后续动态页面、保存非首页位置、退出重载，以及手动滚动模式的上下拖动。

真机脚本为 `scripts/android-pdf-touch-device.cjs`，使用新安装的独立 `xyz.koodoreader.custom.android.restoreqa`。书籍经过真实系统文件选择器，回读原文件 SHA-256；滑动由 Android 原生 `input touchscreen swipe` 发出。验证图片/文字 PDF 四方向、后续页、强制结束进程后的恢复和显式滚动模式。只向 QA 导入合成文件，不配置云账号或同步测试数据。

主应用的五张表、偏好与登录摘要只返回哈希进行比较；启动时可变的 `syncRecord` 单独排除。结束后卸载本轮新建 QA，逐份核验哈希再清理自己的临时 PDF，不清空主应用，也不回写旧设置。

## 验收记录

类型检查、32 个 Vitest 文件中的 223 项测试，以及最终生产资源的 25 项浏览器回归全部通过。浏览器回归包含新 PDF 手势、原有五格式、亚马逊格式、中文文字 PDF、阅读交互、连续朗读及跟随。

SM-S9110 / Android 16 的 8 项隔离真机检查通过，覆盖两种 PDF 的四方向触摸、后续页、非首页保存、进程重启恢复，以及显式滚动模式。图片样本已恢复到第六页，实际图片页号与页脚一致；已检查设备截图。

通过后已无损覆盖安装主应用。安装前后五张表、阅读位置、统计、偏好与 MEGA 登录摘要一致，未向真实云端发起同步；QA 及内容核验后的测试文件已清理。主 APK SHA-256 为 `197d18ad861d5b64b37b529cbfa95ef8a76529fe1d3df60cb7e3be0c100e2a8f`，设备实际安装包摘要相同；QA APK SHA-256 为 `80e04d32169c5424582686bf876607091a3e701911f07621e15af7028d4bf017`。

最终包与验证结果以本机忽略目录 `dist/android-device/pdf-touch-browser-report.json`、`pdf-touch-device-report.json`、`pdf-touch-main-update.json` 为准。2026-11-05，所有者授权本轮提交并推送至 Fork 的 `codex/android-phone-prototype` 分支。

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn android:sync
yarn test:android pdf-touch.spec.ts reading.spec.ts formats.spec.ts amazon-pdf.spec.ts speech-chapters.spec.ts speech-follow.spec.ts

# SDK/JDK 与隔离包构建方式沿用 ANDROID_PROTOTYPE.md
.\android\gradlew.bat -p android --offline --no-daemon -PrestoreQa :app:assembleDebug
Copy-Item android/app/build/outputs/apk/debug/app-debug.apk dist/android-device/pdf-touch-qa-debug.apk
# adb / aapt 不在 PATH 时设置 ADB_PATH / AAPT_PATH
node scripts/android-pdf-touch-device.cjs
```
