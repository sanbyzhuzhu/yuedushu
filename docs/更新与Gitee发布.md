# 阅读树：更新与发布

## 更新体验

书架 → 更多 → 关于阅读树下方的「检查更新」。新版本只在这一项显示红点，不弹窗、不自动下载、不打断阅读。后台每 24 小时最多检查一次，启动延后 10 秒执行；长期开启时每小时判断是否到期。也可手动检查或关闭后台检查。

打开更新页查看版本说明，选择「下载更新 → 确认打开下载」，随后在系统浏览器下载安装包，再由 Windows / Android 系统确认安装。本版为检查与下载入口，并非应用内静默安装器。忽略某个版本后不再显示它的红点，更高版本仍会提示。更新偏好仅存本机，不上传书库、阅读记录或网盘凭据。

更新源暂不可用时，错误只显示在更新页，阅读、书架与同步照常使用。安装 0.4.5、远端也是 0.4.5 时显示已是最新版本；以后发布更高版本才会出现红点。

## 发布地址

- Gitee 源码：`https://gitee.com/sanbyzhu/yuedushu`，默认分支 `master`。
- GitHub 源码：`https://github.com/sanbyzhuzhu/yuedushu`，源码同 Gitee。
- GitHub 正式发行版：`https://github.com/sanbyzhuzhu/yuedushu/releases/tag/v0.4.5`。
- Gitee 更新说明：`https://gitee.com/sanbyzhu/yuedushu/raw/master/update.json`。
- Gitee 安装包存放在独立的 `downloads` 分支、`v0.4.5` 目录，主分支保留源码。

Windows 安装包可从 Gitee 匿名下载，33 MB 安卓 APK 的 Gitee Raw 下载要求登录。因此正式 update.json 的 Windows 地址使用 Gitee，安卓地址使用 GitHub 发行版，更新检查仍由 Gitee 提供。安卓 APK 也保存在 Gitee 的 downloads 分支，登录 Gitee 后可从仓库下载。后续若配置了可公开下载的 Gitee Release 附件，可直接替换 update.json 中的安卓链接，不需要重装客户端。

## 后续发布顺序

1. 运行 `node scripts/set-version.mjs 0.4.6`（按实际版本替换），维护 CHANGELOG，再运行 `node scripts/release.mjs all`。保留原安卓签名。
2. 检查 `scripts/publish-config.json`：它定义两个代码仓库与 Windows / Android 下载 URL 模板。打包脚本用真实版本替换 `{version}` 并生成 update.json。
3. 在 GitHub 创建对应发行版，上传安装包、源码 ZIP 和校验值。上传名称使用 ASCII，例如 `ReadingTree_0.4.6_Android.apk`、`ReadingTree_0.4.6_Windows_x64_Setup.exe`、`ReadingTree_0.4.6_Source.zip`；中文本地文件名可保留，上传时重命名即可。
4. 将相同产物上传到 Gitee `downloads` 分支的对应版本目录。匿名验证下载路径。Gitee 大文件可能要求登录，安卓默认使用 GitHub 地址。
5. 最后将生成的 update.json 提交到两端源码仓库 `master` 根目录。先上传安装包，再更新版本文件，避免用户看到无法下载的新版本。
6. 在软件中点击「立即检查更新」，核对版本、发布说明、Windows / Android 下载地址；不要为测试伪造正式版本号。

软件的「检查更新 → 更新来源设置」可修改公开 HTTPS 版本文件地址。若未来更改分支名或托管服务，可在这里调整。仓库使用 GPLv3，源码包包含 LICENSE 与 THIRD-PARTY-NOTICES.md；签名密钥和密码不进入源码包。
