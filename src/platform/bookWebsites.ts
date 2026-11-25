export const BOOK_WEBSITES = {
  'haodoo-net': 'https://haodoo.net/',
  'haodoo-org': 'https://haodoo.org/',
  'standard-ebooks': 'https://standardebooks.org/ebooks',
  'national-library': 'https://www.nlc.cn/',
  'wikisource': 'https://zh.wikisource.org/',
  'ctext': 'https://ctext.org/zh',
  'github': 'https://github.com/',
  'shuge': 'https://shuge.org/',
  'gutenberg-australia': 'https://gutenberg.net.au/',
  'faded-page': 'https://www.fadedpage.com/',
  'gutenberg-canada': 'https://www.gutenberg.ca/',
  'internet-archive': 'https://archive.org/details/texts',
} as const;
export async function openBookWebsite(site: keyof typeof BOOK_WEBSITES, page?: string): Promise<void> {
  const url = new URL(page || BOOK_WEBSITES[site]);
  if (url.origin !== new URL(BOOK_WEBSITES[site]).origin || url.username || url.password) throw new Error('不支持的书库页面');
  const destination = page ? url.href : site;
  const bridge = (window as unknown as { ReadingTreeNativeMenu?: { openWebsite?: (site: string) => boolean } }).ReadingTreeNativeMenu;
  if (bridge?.openWebsite) {
    if (!bridge.openWebsite(destination)) throw new Error('无法打开此书库网站');
  } else if ('__TAURI_INTERNALS__' in window) {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('open_book_website', { site: destination });
  } else {
    window.open(url.href, '_blank', 'noopener,noreferrer');
  }
}
