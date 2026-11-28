# 阅读树（Reading Tree）

极简 · 古典 · 静读。本地优先的中文电子书阅读器，支持 Android 与 Windows。
<img width="1080" height="1440" alt="阅读树社群海报" src="https://github.com/user-attachments/assets/444ea9cb-1c16-457e-b677-9864466d344d" />


## 当前版本：0.4.10 · Wi-Fi 传书

更多 → Wi-Fi 传书可手动开启电脑或安卓的局域网接收服务。另一台设备通过浏览器输入界面显示的地址和 8 位配对码，即可多选电子书上传，成功后直接入架；关闭页面时停止接收。使用说明及测试边界见 [Wi-Fi 传书](docs/0.4.10-WiFi传书.md)。

修复加书后需要退出重进才能看到的问题。新入架后自动清除挡住新书的搜索、分类和阅读状态筛选，定位到第一页优先展示；保留原排序和视图偏好。批量导入首本及时展示，后续按批次刷新；修复异步读取覆盖刚入架记录的问题。

- [Windows x64 安装包（Gitee）](https://gitee.com/sanbyzhu/yuedushu/raw/downloads/v0.4.6/ReadingTree_0.4.6_Windows_x64_Setup.exe)
- [安卓通用 APK（GitHub）](https://github.com/sanbyzhuzhu/yuedushu/releases/download/v0.4.6/ReadingTree_0.4.6_Android.apk)
- [全部安装包、源码与校验值（最新发行版）](https://github.com/sanbyzhuzhu/yuedushu/releases/latest)
- [Gitee 安装包分支](https://gitee.com/sanbyzhu/yuedushu/tree/downloads/v0.4.6)（大文件下载可能要求登录 Gitee）

开发者：朱振坚（公号小二菜园）。0.4.6 主要统一开发者署名和发布资料，阅读功能保持延续。

更多 → 关于阅读树下方的「检查更新」支持后台安静检查、红点提示、手动确认下载和忽略此版本，不弹窗或自动安装。0.4.8 新增应用内后台下载：Windows 签名校验后由用户确认静默安装并重启，安卓校验安装包后由系统确认安装；浏览器下载入口保留。更新说明默认从 Gitee 读取；Windows 安装包由 Gitee 提供，安卓 APK 使用 GitHub 的公开发行版下载，避免 Gitee 大文件匿名下载限制。目录打开时自动定位当前阅读章节；已有划线支持单击、右键或轻点后直接复制和撤销。

书籍可移入固定的“隐藏”分组，不在首页、普通分类和继续阅读中展示，在“全部分类 → 隐藏”查看。封面更换与清除增加独立修订保护，避免旧同步快照恢复原封面。WebDAV 网络书库支持用户的 HTTP / HTTPS 文件夹地址，可逐层浏览并选书下载。详见 [应用内更新与隐藏书架](docs/0.4.8-应用内更新与隐藏书架.md)。

源码同时发布于 [Gitee](https://gitee.com/sanbyzhu/yuedushu) 与 [GitHub](https://github.com/sanbyzhuzhu/yuedushu)。项目沿用仓库已选择的 GPLv3 许可证，保留第三方声明。更新发布流程见 [更新与 Gitee 发布](docs/更新与Gitee发布.md)。

### 继承的书库与阅读能力

新增中文维基文库、中华诗词、Kanripo 汉籍、中国哲学书电子化计划、GITenberg、Standard Ebooks 按需目录与下载；书格等影印资源保留网站入口。修正夜间暖色变成全橙色的问题。无需新增大型依赖，书籍仅在选择后下载。接入方式与限制见 [公版书库升级](docs/公版书库升级.md)。

2026-10-07 舒适阅读更新：修复原书固定字号、脚注小图放大、滚动插图越界与版框贴字；增加页面留白预设，已有书籍无需重新导入。好读 net 支持目录及 EPUB 下载入架，org 支持书目与下载详情。开发者：如水书斋 · 朱振坚。详见 [舒适阅读优化](docs/舒适阅读优化.md)。

保持版本号，首页优先展示续读和藏书；分类可搜索，排列与管理按需展开，统计/备份/同步收在「更多」，版本信息移入「关于阅读树」。用法与验证见 [首页优化](docs/首页优化.md)。

保留 60 本分页、封面按需读取、进度批量读取、批量归类/导入和分批备份。已用 12,000 本独立测试数据验证。使用方法和容量边界见 [大书库优化](docs/大书库优化.md)。

- PDF 文字重排：选择页码生成独立文字副本，原 PDF、书签和批注保留；不包含 OCR。
- 预置古腾堡官方 OPDS、中文藏书和搜索；国学汉籍目录与指定文字章节下载；GitHub 公开仓库文件浏览。
- 好读两站支持应用内公开书目；net 可直接下载 EPUB，org 需登录的下载在原站完成。中国国家图书馆提供系统浏览器入口；Standard Ebooks 支持公开书目与兼容 EPUB 下载。
- 网页书单提取公开静态文件链接；飞书登录附件、动态内容暂不自动解析。

### 继承的格式与桌面能力

- 新增 OFD 文字/PNG/JPEG 重排、HTML 和 ODT 导入。
- 新增网络书库：HTTPS OPDS 1/2、WebDAV、文件直链，以及受限的 Legado 纯 CSS 书源。
- Markdown 一级、二级标题和下划线式标题进入目录，保留正文标题，旧书补充二级标题导航。
- Windows 关闭收到系统托盘，单击恢复，托盘菜单或书架「更多 → 退出阅读树」才结束程序。

使用步骤与兼容限制见 [轻量格式与网络书库](docs/轻量格式与网络书库.md)。

### 继承的阅读与书架优化

- 手机书籍菜单使用完整屏内面板，封面更多按钮透明，分类栏横向滑动并固定全部分类入口。
- 分类支持新建、重命名、删除；支持按书名和分类筛选后批量归类，删除分类保留书籍及子分类。
- 正文和 PDF 均支持书签管理、查找、重命名、跳转和删除，同一位置不重复添加。
- Android 原生返回先关闭弹层，正常阅读返回书架；只在书架连续返回两次退出。状态栏和键盘区域按系统安全区避让。

- 竖排版框增加随字号变化的上下留白，保留整列分页与界行对齐。
- 重绘阅读树图标，Android 前景与背景分离，果实与书本完整落在自适应图标安全范围内。
- 笔记草稿自动保留在本机，关闭或重开应用后可继续写；支持放弃草稿恢复原笔记。
- 目录支持按章节名筛选，保留原章节编号。

- 手机长按后拖动两端圆点选字，选到本页末行后继续下拖才翻一页、反向可缩选；选区按实际位置保存，支持单字和长摘录。移除了固定字数续选按钮，书架直接显示 v0.3.14，便于核对安装版本。
- 统一纸色、墨色、朱砂和题签视觉；书架增加续读入口，收起次要管理操作。
- 排版设置分为常用、纸墨、版式、更多，提供舒朗、古籍、舒目预设。
- 搜索可定位匹配文字所在页；笔记可按类型和内容筛选，支持 Markdown、TXT、CSV 导出。
- 修复近 30 天及累计阅读统计；整理朗读、同步、备份面板。

完整变更与验证范围见 [功能与古典极简设计审查](docs/功能与古典极简设计审查.md) 和 [阅读交互优化](docs/阅读交互优化.md)。

## 功能

书籍导入、分类、网格/列表/树架视图；横排、竖排、双页、滚动阅读；本书独立排版；纸墨主题、自定义字体、简繁转换；划线、批注、书签、摘录卡片；系统语音朗读；阅读统计；本地备份恢复与 WebDAV 同步。

格式解析包括 TXT、Markdown、EPUB、DOCX、MOBI/AZW3、PDF、FB2、CBZ、HTML、ODT、OFD 文字重排，以及尽力解析的 UPDB。扫描型 PDF 需要文本层才能直接选字。复杂书籍的排版兼容性仍取决于源文件结构。

## 开发与验证

```sh
npm ci
npm run dev
npm run typecheck
npm run build
npm run test:reader
npm run test:panels
npm run test:touch
npm run test:polish
npm run test:library
npm run test:network
npm run test:public
npm run test:large
node scripts/test-reading-comfort.mjs
node scripts/test-haodoo.mjs
```

浏览器回归默认使用本机 Microsoft Edge；可通过 `PW_CHANNEL` 指定 Playwright 支持的其他已安装浏览器通道。测试使用独立书库，不接入真实云账户。

```sh
npx esbuild scripts/sync-test.ts --bundle --platform=node --format=esm --outfile=.tmp/sync-test.mjs
node .tmp/sync-test.mjs
```

## 打包

```sh
npm run release -- windows
npm run release -- android
npm run release -- source
# 或一次构建三种交付物
npm run release -- all
```

输出到 `releases/<版本>/`，包含 SHA-256 校验文件。源码归档读取当前工作目录中的文件内容，包含尚未提交的修改；排除依赖、构建缓存、安装包及签名密钥。

环境、签名配置和重新构建步骤见 [打包与交付](docs/打包与交付.md)。原有 `scripts/build-release.cmd` 与 `scripts/build-android.cmd` 保留为入口。

## 结构

工程验证与专项脚本索引见 [测试入口](docs/测试入口.md)；P0–P5 的真实完成状态见 [工程升级进度](docs/工程升级进度.md)。版本与许可声明工具见 [发布与许可证](docs/发布与许可证.md)。

```text
src/engine/    阅读、分页、解析、划线、朗读
src/ui/        书架、阅读器及功能面板
src/store/     本地状态与设置
src/platform/  IndexedDB 存储及平台接口
src/sync/      WebDAV 传输、合并与同步
src/styles/    正文排版和界面视觉
src-tauri/     Windows / Android 原生壳
```

Tauri 内通过 HTTP 插件连接 WebDAV；浏览器开发环境仍受服务端跨域配置约束。应用选区手柄已通过浏览器触摸回归，Android WebView、输入法、系统声音及真实云恢复仍需对应设备/账户验收。

图标重建：`node scripts/render-icon.mjs`。此脚本生成桌面与安卓图标，并验证所有前景像素处于 Android 自适应图标的安全圆内。
