# 阅读树：安静更新与 Gitee 发布

## 0.4.5 更新体验

书架 → 更多 → 关于阅读树下方的「检查更新」。新版本只在这一项显示红点，不弹窗、不自动下载、不打断阅读。后台每 24 小时最多检查一次，启动延后 10 秒执行；长期开启时每小时判断是否到期。也可手动检查或关闭后台检查。

打开更新页可以查看版本号和说明，选择「下载更新 → 确认打开下载」，随后在系统浏览器下载安装包，再由 Windows / Android 系统确认安装。本版为检查与下载入口，并非应用内静默安装器。忽略某个版本后，不再显示它的红点；更高版本仍会提示。更新偏好仅存本机，不上传书库、阅读记录或网盘凭据。

更新源暂不可用时，错误只显示在更新页，阅读、书架与同步照常使用。若上次已发现新版，断网后保留该版本的信息并标明是缓存结果。

## 本次默认配置

- Gitee 账号：`sanbyzhu`。
- 用户已创建的仓库：`https://gitee.com/sanbyzhu/yuedushu`。
- 默认检查地址：`https://gitee.com/sanbyzhu/yuedushu/raw/master/update.json`。
- 配置文件：`src/update-source.json`。安装后也可在「检查更新 → 更新来源设置」修改。

仓库尚未创建或未发布 update.json 时，不会出现真实的新版本提示。当前源码不包含 Gitee / GitHub 发布令牌，打包不会自动上传或创建仓库。

## 首次发布顺序

1. 使用已创建的 Gitee `yuedushu` 仓库，确认设为公开，代码分支使用 `master`。如使用 `main`，修改上述配置或在软件的来源设置里修改分支名。
2. 上传审核后的项目源码。源码 ZIP 已排除本机签名、密码、依赖及构建缓存；发布前自行选定项目许可证，保留 `THIRD-PARTY-NOTICES.md`。
3. 创建发行版，标签为 `v0.4.5`，复制 `releases/0.4.5/发布说明.md` 的内容，上传同目录中的 EXE、APK、源码 ZIP 和 SHA256SUMS.txt。不要随意改安装包文件名。
4. 打开发行版，复制两份安装包实际的公开下载地址，和本次生成的 `releases/0.4.5/update.json` 中的 `downloads` 对照。生成的地址按 Gitee 的 release 下载路径填写，若实际地址不同，以实际地址替换。
5. 先用未登录浏览器确认 EXE 与 APK 链接可访问，再将核对后的 update.json 提交到仓库 `master` 分支根目录。必须先上传安装包，再更新版本说明文件，避免用户收到不存在的下载。
6. 在软件更新页点「立即检查更新」。安装 0.4.5、远端也是 0.4.5 时应显示已是最新版本；以后发布 0.4.6 等更高版本才会出现红点，不要为了测试伪造正式版本号。

Gitee 的公开原始文件和附件访问策略可能变化。若出现登录页或访问限制，可改为可匿名访问的 HTTPS 静态托管地址；软件不用重新安装，只需修改更新来源。Gitee 来源仍可作为默认，GitHub 仅镜像代码或发行版，两者不必同时接通。

## 后续发布

执行 `node scripts/set-version.mjs 0.4.6`（按实际版本替换），维护 CHANGELOG，再执行 `node scripts/release.mjs all`。它会生成两端安装包、最新源码 ZIP、update.json 和 SHA256SUMS.txt。沿用原安卓签名与应用标识，版本代码自动递增，覆盖升级。

GitHub 仓库名建议也为 `yuedushu`，账号和 URL 尚未指定。本次不创建或推送公开仓库。可以把相同源码和发行版上传到 GitHub；客户端仍只读取配置的 Gitee update.json。

版本文件示例（地址和版本按实际发布填写）：

```json
{
  "version": "0.4.5",
  "publishedAt": "2026-11-25T00:00:00Z",
  "notes": "更新内容说明",
  "downloads": {
    "windows": "https://gitee.com/sanbyzhu/yuedushu/releases/download/v0.4.5/Windows安装包文件名.exe",
    "android": "https://gitee.com/sanbyzhu/yuedushu/releases/download/v0.4.5/安卓安装包文件名.apk"
  }
}
```
