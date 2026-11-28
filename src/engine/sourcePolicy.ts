/** Public, anonymous reading sources only. Sync/WebDAV credentials are separate. */
export function assertPublicSource(source: Record<string, any>) {
  if (source.loginUrl || source.loginCheckJs || source.loginUi) throw new Error('登录书源不导入：请使用无需登录的公开书源');
  if (source.bookSourceType && String(source.bookSourceType) !== '0') throw new Error('本批仅支持文本书源，暂不支持音频、漫画等类型');
}
export function assertAnonymousRequest(value: string) {
  if (/(?:[?&"']|^)(?:password|passwd|token|access_token|refresh_token|auth_token|sessionid|api_key|apikey)["']?\s*[:=]/i.test(value)) throw new Error('书源请求包含登录或认证字段，不予导入');
}
