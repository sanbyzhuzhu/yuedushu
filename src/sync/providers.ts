/** WebDAV 服务商预设（V0.4.0）
 *  同步引擎本身是服务商无关的（标准 GET/PUT/MKCOL/DELETE + Basic Auth），
 *  这里只提供常见服务商的地址格式与密码获取指引，帮助填写连接设置。 */
export interface WebDAVPreset {
  id: string;
  label: string;
  /** 地址固定的服务商（坚果云）选预设时直接填入 */
  url?: string;
  placeholder: string;
  urlHint: string;
  passHint: string;
}

export const WEBDAV_PRESETS: WebDAVPreset[] = [
  {
    id: 'jianguoyun',
    label: '坚果云',
    url: 'https://dav.jianguoyun.com/dav/',
    placeholder: 'https://dav.jianguoyun.com/dav/',
    urlHint: '坚果云地址固定，一般无需修改。',
    passHint: '获取：坚果云网页端 → 账户信息 → 安全选项 → 第三方应用管理 → 添加应用密码。',
  },
  {
    id: 'teracloud',
    label: 'InfiniCLOUD',
    placeholder: 'https://xxx.teracloud.jp/dav/',
    urlHint: '地址形如 https://xxx.teracloud.jp/dav/，xxx 为账号所在节点，见网页端「WebDAV 连接」说明。',
    passHint: '获取：InfiniCLOUD 网页端 → 我的应用 → 已连接的应用 → 生成连接应用密码。',
  },
  {
    id: 'nextcloud',
    label: 'Nextcloud / ownCloud',
    placeholder: 'https://你的域名/remote.php/dav/files/用户名/',
    urlHint: '地址形如 https://你的域名/remote.php/dav/files/用户名/（结尾的文件路径不可省略）。',
    passHint: '获取：Nextcloud 网页端 → 个人设置 → 安全 → 创建新应用密码（部分服务器也接受登录密码）。',
  },
  {
    id: 'custom',
    label: '自定义 / 其他',
    placeholder: 'https://dav.example.com/dav/',
    urlHint: '任何标准 WebDAV 均可：本机或局域网服务（Alist、群晖 NAS、rclone 等）http 与 https 地址均可，http 为明文传输建议仅本地/局域网使用。浏览器网页环境需服务端允许跨域；打包应用内不受限。',
    passHint: '请使用该服务提供的账号与应用密码（如有）；群晖等 NAS 一般直接用登录账号密码。',
  },
];

export const PRESET_CUSTOM = WEBDAV_PRESETS[WEBDAV_PRESETS.length - 1];

/** 按地址识别服务商（用于账号列表显示与提示文案），识别不出归入「自定义」 */
export function detectPreset(url: string): WebDAVPreset {
  const u = (url || '').trim().toLowerCase();
  if (u.includes('jianguoyun')) return WEBDAV_PRESETS[0];
  if (u.includes('teracloud')) return WEBDAV_PRESETS[1];
  if (u.includes('remote.php/dav') || u.includes('nextcloud') || u.includes('owncloud')) return WEBDAV_PRESETS[2];
  return PRESET_CUSTOM;
}
