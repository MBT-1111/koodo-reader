# 安卓亚马逊格式与文字 PDF 样本

这些文件全部由项目自行生成，不包含用户书籍或云端数据。

- `mobi-zh.mobi`：Calibre 9.17.0 输出的 MOBI 6，UTF-8 中文、两个章节。
- `azw-zh.azw`：独立标题的无 DRM MOBI 6 内容，使用旧式 AZW 扩展名；不是 KFX，也不模拟 DRM。
- `azw3-zh.azw3`：真正的 KF8 / MOBI 8 输出，没有把 EPUB 或 MOBI 6 改名冒充 AZW3。
- `pdf-zh-1col.pdf`、`pdf-zh-2col.pdf`：Chrome 打印生成的四页中文文字 PDF，包含字体子集和可提取文字；分别为单栏、双栏。PDF 文件内保留嵌入字体，测试不依赖手机安装同名字体。

生成器 `scripts/generate-android-amazon-pdf.cjs` 使用已有 JSZip、Playwright。生成亚马逊格式时先设置 `CALIBRE_CONVERT` 指向本机 `ebook-convert.exe`；Calibre 的配置与临时文件限定在项目忽略目录 `dist/android-format-tools/`，不读取个人 Calibre 书库。

```powershell
$env:CALIBRE_CONVERT = '本机 Calibre 路径\ebook-convert.exe'
node scripts/generate-android-amazon-pdf.cjs
```

测试使用仓库内的样本，不会在每次运行时下载工具或重新生成。生成器会核对 PDB 的 `BOOKMOBI` 标记、MOBI 版本 6/8，以及 PDF 的字体流。Calibre 下载自[官网便携版](https://calibre-ebook.com/download_portable)，转换选项依据[官方命令文档](https://manual.calibre-ebook.com/generated/en/ebook-convert.html)。本轮便携工具的 Windows 签名已验证为 Kovid Goyal；工具与下载件不进入应用或代码提交。
