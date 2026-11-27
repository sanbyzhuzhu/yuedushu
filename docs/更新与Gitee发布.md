# 阅读树：更新与发布

## 更新体验

书架 → 更多 → 关于阅读树下方的「检查更新」。新版本只在这一项显示红点，不弹窗、不自动下载、不打断阅读。后台每 24 小时最多检查一次，启动延后 10 秒执行；长期开启时每小时判断是否到期。也可手动检查或关闭后台检查。

0.4.8 起可选择「应用内下载 → 确认开始下载」，下载期间可关闭面板继续阅读。下载完成后再确认安装：Windows 校验签名和签署版本后以 quiet 模式覆盖安装并重新打开；安卓校验 SHA-256、包名和正式签名后打开系统安装确认，首次可能需要授权安装来源。浏览器下载备用入口继续保留。旧客户端需先手动覆盖安装支持此功能的版本。忽略某个版本后不再显示它的红点，更高版本仍会提示。更新偏好仅存本机，不上传书库、阅读记录或网盘凭据。

更新源暂不可用时，错误只显示在更新页，阅读、书架与同步照常使用。远端版本不高于已安装版本时显示已是最新版本；发布更高版本才会出现红点。

## 发布地址

- Gitee 源码：`https://gitee.com/sanbyzhu/yuedushu`，默认分支 `master`。
- GitHub 源码：`https://github.com/sanbyzhuzhu/yuedushu`，源码同 Gitee。
- GitHub 正式发行版：`https://github.com/sanbyzhuzhu/yuedushu/releases/tag/v0.4.6`。
- Gitee 更新说明：`https://gitee.com/sanbyzhu/yuedushu/raw/master/update.json`。
- Gitee 安装包存放在独立的 `downloads` 分支、`v0.4.6` 目录，主分支保留源码。

Windows 安装包可从 Gitee 匿名下载，33 MB 安卓 APK 的 Gitee Raw 下载要求登录。因此正式 update.json 的 Windows 地址使用 Gitee，安卓地址使用 GitHub 发行版，更新检查仍由 Gitee 提供。安卓 APK 也保存在 Gitee 的 downloads 分支，登录 Gitee 后可从仓库下载。后续若配置了可公开下载的 Gitee Release 附件，可直接替换 update.json 中的安卓链接，不需要重装客户端。

## 后续发布顺序

1. 运行 `node scripts/set-version.mjs 0.4.7`（按实际版本替换），维护 CHANGELOG，再运行 `node scripts/release.mjs all`。保留原安卓签名。
2. 检查 `scripts/publish-config.json`：它定义两个代码仓库与 Windows / Android 下载 URL 模板。打包脚本用真实版本替换 `{version}` 并生成 update.json。
3. 在 GitHub 创建对应发行版，上传安装包、源码 ZIP 和校验值。上传名称使用 ASCII，例如 `ReadingTree_0.4.7_Android.apk`、`ReadingTree_0.4.7_Windows_x64_Setup.exe`、`ReadingTree_0.4.7_Source.zip`；中文本地文件名可保留，上传时重命名即可。
4. 将相同产物上传到 Gitee `downloads` 分支的对应版本目录。匿名验证下载路径。Gitee 大文件可能要求登录，安卓默认使用 GitHub 地址。
5. 最后将生成的 update.json 提交到两端源码仓库 `master` 根目录。先上传安装包，再更新版本文件，避免用户看到无法下载的新版本。
6. 在软件中点击「立即检查更新」，核对版本、发布说明、Windows / Android 下载地址；不要为测试伪造正式版本号。

软件的「检查更新 → 更新来源设置」可修改公开 HTTPS 版本文件地址。若未来更改分支名或托管服务，可在这里调整。仓库使用 GPLv3，源码包包含 LICENSE 与 THIRD-PARTY-NOTICES.md；签名密钥和密码不进入源码包。

0.4.8 起构建需保留 `.updater-signing.local.json` 中的原签名密钥。发布脚本会生成 Windows `.sig`，并将平台签名、签署版本对应的 URL 和双端 SHA-256 加入清单；不要手工删去这些字段。客户端内嵌公钥保持不变，不得为每个版本重新生成密钥。详见 [0.4.8 说明](0.4.8-应用内更新与隐藏书架.md)。

## 宣发入口

宣发二维码统一指向 https://github.com/sanbyzhuzhu/yuedushu/releases/latest ，版本更新后保持入口不变。文案中的版本号和功能说明仍需按实际发布同步维护。
