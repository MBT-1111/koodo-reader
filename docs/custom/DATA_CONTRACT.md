# Windows 数据契约与验证

2026-10-31；基线 42443d83。不读取真实配置或书库，不拆解压缩引擎；以可见业务调用和公开接口的合成执行结果取证。

## 业务数据矩阵

| 业务数据 | 实际持久化与入口 | Custom 采集与应用 |
| --- | --- | --- |
| 书籍信息 | books 表；DatabaseService 与直接 database-command/custom-database-command 调用 | 全表采集，仅白名单 metadata；本机路径/封面保持，远端不创建没有本地文件的书籍 |
| 笔记/高亮 | notes 表；Note/NoteSyncManager/DatabaseService | 全表采集，UUID 映射，bookKey 转内容 hash；新实体分配本机独立 key，删除同步 SQL 行 |
| 书签 | bookmarks 表；Bookmark/DatabaseService | 同上，不假设时间戳 key 全局唯一 |
| 阅读位置 | recordLocation JSON 对象；viewer、progressPanel、mouseEvent 等调用 ConfigService.setObjectConfig | 按书籍采集明确位置字段，在无 reader 打开时应用 |
| 书架 | shelfList JSON map；sidebar、bookDrag、书架对话框 | 书架存在和成员分别同步；重命名是删除旧名/创建新名；不使用本机 key 作为云成员标识 |
| 收藏/回收站/最近 | favoriteBooks、deletedBooks、recentBooks 列表 | 转换书籍 ID；回收站标记传播，绝不物理删除书籍文件 |
| 笔记标签 | noteTags 列表与 Note.tag | 标签目录单独同步；notes 的 tag 随记录同步 |
| 累计阅读时长 | readingTime JSON `{bookKey: seconds}` | 独立累计计数器 |
| 每日阅读统计 | readingStats JSON `{YYYY-MM-DD: ["bookKey-seconds"]}` | 按最后一个 `-` 拆分，按日期/书籍转换计数器 |

采集覆盖白名单的当前快照，因而不依赖业务写入是否经过 DatabaseService。配置、插件、API Key、令牌、路径、封面、原始文件、同步内部设置不在上传白名单；合集 bookCollection 和阅读/界面偏好尚未纳入此协议。

## 合成执行证据

`src/custom/sync/persistence.test.ts` 在空 Map 实现的 localStorage 中正常导入公开 ConfigService/ReadingTimeUtil，使用合成书籍、受控时钟和 unload handler，确认每书累计与每日编码格式，以及 `getAllDates/getDayStats` 的结果。两段阅读分别产生 6 秒和 4 秒，确认累计与每日值均为 10 秒。测试不把真实 localStorage 注入引擎。

同一测试使用 Node 内置 `node:sqlite` 的 `:memory:` 数据库，调用公开 SqlStatement 的建表语句与 JSON/SQLite 转换器，执行实际笔记保存、读取、更新及批次冲突回滚；另验证书籍元数据更新保留原路径与封面，以及书签删除。此测试没有在 React 渲染进程引入 SQLite；实际应用的 SQL 写入仍仅通过 database-command。

该证据确认这些公开接口在当前样本中的行为，不等于已审计不可见内部实现、所有历史版本或真实用户数据。Windows better-sqlite3/Electron ABI 与大数据量测试仍需云端和人工验收。

## 写入安全

主进程同步会话绑定 WebContents、书库路径、账户和同步空间；同步期间阻止打开新 reader。SQL 批次先比较原记录，再在同步事务中写入，任何不一致使整批失败。多表依次写入，失败时逆向 CAS 回滚已完成批次；配置在无异步间隙的比较后写入，空值恢复时 removeItem，不写成字符串 null。

上传前和上传后均重采集比较本地数据。失败回滚不能完成时保存恢复标志、关闭自动同步并拒绝继续普通同步。恢复入口只读本地备份，不访问 Provider；恢复前另存当前数据，仍通过同一 CAS 通道，且不允许改变书籍文件/封面或增删书籍行。

applying 标志在任何数据库/配置变更前持久化；进程中断后也会阻止继续同步。数据库主进程在异步导入 SQL 转换器前后都核验会话，再执行同步事务，避免已取消的异步调用继续写入。
