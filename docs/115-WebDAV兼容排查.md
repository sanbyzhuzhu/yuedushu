# 115 WebDAV 兼容排查（2026-11-11）

## 已验证

- 本地服务监听 11501，进程为 `D:\Program Files\115-Desktop\115-Desktop.exe`。
- 根目录及“阅读树”“知识树备份”目录 PROPFIND 返回 207；认证正常。
- 云端确有知识树备份，其中 `知识树备份-2026-11-11-200655.db` 大小 243351552 字节；不能将知识树成功简单解释为只通过目录连接测试。
- 知识树源码 `E:\Anti\zhishishu\zhishishu`：通过 Rust reqwest PUT 整库数据库，Content-Type 为 application/octet-stream，时间戳文件名；连接测试则只检查目录。
- 阅读树以 JSON 保存逐书同步数据，并以二进制上传原文件。
- 初次微小文件测试曾返回 PUT 201、GET 200 且内容一致、DELETE 204；之后测试持续返回 500。服务端响应明确包含“OSS上传失败: HTTP 403, AccessDenied, Access denied by bucket policy”。
- 同时测试本机地址和局域网地址均出现相同失败。
- 相同数据分别使用 JSON 与 octet-stream 请求头均失败。
- 在两个目录使用唯一临时名称、.db 与 .json 后缀测试均失败；64 KiB、1 MiB、10 MiB、32 MiB 均失败。
- 测试仅使用合成数据，没有读取或修改已有知识树数据库、书籍和同步清单；成功创建的临时文件均已删除。

## 结论和边界

当前上传被代理上游 OSS 拒绝，尚不能由此确定具体代理实现错误。知识树已有大文件成功记录，不代表相同时间任意新文件都能上传，也不能证明与小文件处理无关。尚未复现知识树当前完整 232 MiB 数据库的新内容上传；没有进行大体积填充或格式伪装作为规避措施。

阅读树 0.4.2 修复安卓正式版 HTTP 连接、提供独立读写测试并显示已知上游错误。客户端修复不等于服务端上传拒绝已解决。下一步需查看 115-Desktop 上传实现源码或服务端上传日志，比较成功数据库请求与失败小文件的 OSS 签名、临时令牌和上传流程；不能只凭响应推断账号过期。

文档不保存账号密码、签名 URL 或令牌。

## 官方说明核对

- 发布地址：https://115-desktop.feishu.cn/wiki/CLuiwivFjiKDSTk9QuzcXXDbn6f 。2026-11-11 查看时最新列出的版本为 1.5.8.3；本机 EXE 的 FileVersion/ProductVersion 同为 1.5.8.3。
- 高级功能介绍“二十八、WebDAV功能”：https://115-desktop.feishu.cn/wiki/SH0aw3Vmtiz3bBkody2c7E6Jnpf#BqKjdCNCVoygzOxVwURcGPeAnUh 。官方明确支持文件上传、下载、播放预览、新建文件夹、重命名、移动、删除；入口为“百宝箱 → 工具 → WebDAV管理”。
- 已阅读的 WebDAV 功能说明没有规定特殊备份格式，也没有给出 OSS bucket policy 错误的处理办法。因此不能把失败归因为“工具不支持上传”，也不能将换后缀或 MIME 类型当作已证实的解决方案。
- 浏览器读取的页面快照保存在 output/playwright/115-webdav6.yml；没有登录飞书、提交反馈或修改 115-Desktop 配置。

## 有效 EPUB 与其他格式对照上传

用户授权后，生成包含未压缩 mimetype、container.xml、OPF 元数据/manifest/spine、导航和 XHTML 正文的小型 EPUB 3 文件，而非仅更换后缀。同时生成真实 ZIP 及 JSON/TXT 文本，使用唯一临时文件名在“阅读树”目录逐个上传。

| 格式 | 请求 Content-Type | 大小（字节） | 结果 |
| --- | --- | ---: | --- |
| JSON | application/json;charset=utf-8 | 141 | HTTP 500，OSS AccessDenied / bucket policy |
| EPUB | application/epub+zip | 1538 | HTTP 500，同上 |
| EPUB（相同内容） | application/octet-stream | 1538 | HTTP 500，同上 |
| ZIP | application/zip | 261 | HTTP 500，同上 |
| TXT | text/plain;charset=utf-8 | 141 | HTTP 500，同上 |

每项测试后均对本次唯一临时文件执行 DELETE，均返回 404，未留下可见的测试文件。由于上传均失败，未能进入下载内容一致性验证。已有书籍、备份和同步清单未修改。

结论：当前服务的上传失败不限于 JSON 后缀；将同步数据包装为 EPUB/ZIP 尚无成功依据。本次未测试大体积 EPUB，也未验证其他时间或服务重启后的行为。
