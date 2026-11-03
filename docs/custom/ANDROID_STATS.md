# Android 阅读统计

2026-11-03，在 `codex/android-phone-prototype` 接入手机设置 → Reading Stats（阅读统计）。

## 页面与参考范围

实际查看已连接手机上的官方 `com.koodoreader.expo` 应用 Settings → Reading stats，只检查可见界面，不访问官方应用私有数据。

- 四项概览：已读书籍、累计阅读时长、最长连续阅读天数、日均时长。
- 最近 7 天：柱状图与折线趋势切换，下方列出每日时长，触屏无需悬停也可读取数据。
- 最近 90 天：按星期排列阅读活动格子，附强度图例。
- 支持刷新、空状态、加载失败重试、设置页返回、深色和 E-ink。图表关闭动画；E-ink 活动强度采用黑白纹理。

复用现有 Recharts 和手机设置容器；桌面 `/stats` 页面保持原有实现。没有复制官方应用中的统计数值。

## 数据口径

页面只读，不新增计时器或统计存储。通过 `DatabaseService` / `database-command` 获取书籍键，通过 `ConfigService` 获取现有 `readingStats`、`readingTime`、`recordLocation` 和 `deletedBooks`。

- 每日记录沿用 `日期 → [书籍键-累计秒数]` 协议，同一书籍同一天的重复累计值取最大值，支持带连字符的书籍键。
- 累计时长按书合并每日总和与历史 `readingTime`，取较大值以保留缺少日期的旧记录，避免两份数据重复计入。
- 已读书籍统计当前书库中有阅读位置或正时长的书籍，排除回收站。历史累计时长保留已移除书籍的记录。
- 日均时长以有日期的有效阅读日计算。只有累计时长、没有日期的旧记录不猜测所属日期。
- 连续天数取全部有效历史中最长的一段；日期按手机本地日历处理，7 天和 90 天窗口均含今天，无阅读日期填零。
- 忽略非法日期、未来每日记录、无效或非正活动时长；不修改源记录。

## 验证

```powershell
yarn typecheck
yarn test --maxWorkers=2
yarn build:android
$env:PLAYWRIGHT_CHROMIUM_CHANNEL='chrome'
yarn test:android stats.spec.ts settings-notes.spec.ts

# 覆盖安装前记录当前手机摘要，不保存配置值或密钥
$env:ADB_PATH='D:\Android\AndroidSDK\Sdk\platform-tools\adb.exe'
node scripts/android-stats-device.cjs --baseline
# 安装后运行原生触控、刷新、重启和数据保全检查
yarn test:android:stats
```

类型检查、188 项单元测试、8 项相关手机浏览器回归通过。包含累计值去重、旧数据合并、闰年/跨年、本地日期、空数据、320px 窄屏/横屏/深色/E-ink，以及实际阅读后退出、重新打开统计的数据一致性。

真机使用 SM-S9110 / Android 16，覆盖安装后检查 8 本书、11 条笔记、1 条书签、4 个插件的完整记录摘要。查看页面、切换图表、刷新前后所有设置和记录一致；重启时单独排除已有启动逻辑更新的 `syncRecord` 同步时间戳，仍逐项校验其余设置、阅读计数和全部主记录。不会将较早的设置快照写回手机。

截图和摘要报告位于忽略目录 `dist/android-device/stats-*`；官方参考截图是 `official-reading-stats-*.png`。浏览器截图仅使用隔离测试数据，不写入手机。
