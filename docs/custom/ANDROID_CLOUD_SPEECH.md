# Android Azure 与 MiMo 朗读

2026-11-04 最新行为见 [ANDROID_READING_SPEECH.md](ANDROID_READING_SPEECH.md)：已支持 EPUB/TXT 正文跟随、多角色自动跨章、阅读位置持久化及中断终止。下文保留早期云朗读的行为与验收记录。

2026-11-04 后续：EPUB/TXT 单音色自动跨章已完成本地及短时 Home 真机检查，见 [ANDROID_CHAPTER_SPEECH.md](ANDROID_CHAPTER_SPEECH.md)；多角色继续按章朗读。

后续已接入 Gemini 角色分析及 Azure/MiMo 混合多角色队列，使用与边界见 [ANDROID_MULTIROLE.md](ANDROID_MULTIROLE.md)。下文保留首批云朗读的验收记录。

2026-11-03。按用户实际使用的服务，本批只接入 Azure 和 MiMo，保留系统离线语音。分支 `codex/android-phone-prototype`。

## 使用

1. 在“设置 → 插件 → 语音”安装 Azure TTS 或 MiMo TTS。Azure 填写区域和 API Key；MiMo 填写 API Key。手机上的密钥输入框使用密码形式显示。
2. 打开书籍，点击阅读工具栏的扬声器，在“朗读服务”选择系统语音、Azure 或 MiMo，再选择音色、语速并开始。可从面板跳转到插件配置，也可刷新已安装服务的音色。
3. Azure 可选择音色支持的情绪和强度，沿用桌面的偏好；MiMo 使用预置音色，语速通过本机播放调整。更改服务、音色、情绪及语速前需停止当前播放。

云朗读以完整段落为基础，合并为最多 1200 个 UTF-16 字符的片段，保留标点且不切断代理对。当前章节从可见文本开始，分段请求、生成和播放；不会一次上传整本书。首批没有预生成下一片段；2026-11-04 已补上一次提前一段的原生预生成，行为和验证见 [ANDROID_CONTINUITY.md](ANDROID_CONTINUITY.md)。仍未接入流式播放。

支持等待生成时暂停/切段/停止、缓存音频位置继续、上一段/下一段、关闭面板继续、后台续读、媒体按钮控制，以及音频焦点中断后暂停。继续时从缓存音频的位置播放；尚未生成音频时暂停，继续会重新请求。退出阅读、切书、移除最近任务、出错或本章结束时停止并清理临时音频。自动跨章、跟读翻页和朗读位置跨进程恢复仍未接入。

## 原生实现

手机插件页只开放这两个内置语音提供器，不执行桌面 Node 语音脚本或任意自定义语音脚本。Azure 音色列表使用原生 HTTP 获取；MiMo 预置音色不发起合成请求。插件配置沿用现有本机插件记录，不自动复制电脑中的密钥。

生成和播放由 `NativeSpeechService` 完成，继承现有前台服务、媒体会话、通知、音频焦点和唤醒锁。HTTP 在后台工作线程运行，音频由 MediaPlayer 解码播放，后续片段不依赖 WebView 计时器。每次会话及播放修订均校验标记，过期结果和旧播放回调不会推进当前队列。

Azure 沿用区域地址、订阅密钥请求头、SSML 转义、相对语速、情绪/强度和 MP3 输出。MiMo 使用 `mimo-v2.5-tts`，正文位于 assistant 消息，读取返回的 base64 音频。协议依据 [Azure REST 文档](https://learn.microsoft.com/en-us/azure/ai-services/speech-service/rest-text-to-speech) 和 [MiMo 语音合成文档](https://mimo.mi.com/docs/en-US/quick-start/usage-guide/audio/speech-synthesis-v2.5)。

请求禁止自动重定向，使用连接/读取超时和响应大小上限，不记录密钥或正文。正式构建只允许 HTTPS；调试构建的本机环回 HTTP 仅用于现有 ADB 转发测试规则。单个会话最多保留两份私有临时音频；停止和错误时清理，进程重启后再清理残留片段。合成请求取消不保证服务端停止计费。

## 验证

测试入口：

```powershell
yarn test:android speech.spec.ts
$env:ADB_PATH = '现有 Android SDK 的 platform-tools/adb.exe'
yarn test:android:cloud-speech
yarn test:android:speech
```

设备脚本使用已有合成《安卓章节样本》，临时写入隔离测试服务配置，返回可解码的合成音频，实际经过本机 HTTP、MediaPlayer、媒体会话和 Android 生命周期。不会使用真实云账户；结束时恢复原有插件、阅读偏好、位置与统计，并核对全部主库记录。报告与截图位于忽略跟踪的 `dist/android-device/cloud-speech-report.json` 和 `cloud-*.png`。

本批类型检查、178 项 Vitest、33 项手机界面回归、5 项原生队列单元测试、30 项 Android 原生测试及 Android Lint 通过。SM-S9110 / Android 16 的云朗读脚本 8 项与系统离线朗读回归 8 项通过，包含 Azure 鉴权及额度错误恢复、SSML 情绪/强度/相对语速、MiMo 音频解码、缓存继续、Home 后续段生成、媒体按钮、跨 UID 音频焦点中断、生成中暂停/停止、无效音频和队列结束后的资源清理。

最终 APK 已覆盖安装，并核对手机实际加载的入口与本次构建相同。新增语音页签在手机设置内无横向溢出，换行时按实际页签高度定位语音列表。升级后主库五张表（8 本书、11 条笔记、1 个书签，单词及插件记录为 0）的数量及 SHA-256 与 E-ink 升级前基线一致；原有 E-ink/主题设置保留，朗读空闲且临时音频为空。结果位于 `dist/android-device/cloud-install-final.json`。

真实 Azure/MiMo 密钥、账号额度、网络环境及语音品质仍需配置后验证。云语音的长时间后台、实际来电和耳机拔出仍未计为通过；此前系统 TTS 的锁屏短时验收不能直接替代云语音验收。
