/** 阅读树 · 核心数据类型 */

export type BookFormat =
  | 'txt'
  | 'md'
  | 'epub'
  | 'mobi'
  | 'pdf'
  | 'docx'
  | 'updb'
  | 'fb2'
  | 'cbz'
  | 'ofd'
  | 'html'
  | 'odt';

export interface BookMeta {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  size: number;
  addedAt: number;
  nodeId: string | null;
  cover?: string;
  /** Local lightweight metadata: cover bytes are stored separately. */
  hasCover?: boolean;
  /** Separate cover revision preserves replacements and explicit removals across sync. */
  coverUpdatedAt?: number;
  /** Hidden books remain local and readable only through the hidden shelf. */
  hidden?: boolean;
  updatedAt?: number;
  /** Explicit completion overrides the progress-derived status without moving the reading position. */
  completed?: boolean;
}

/** 章节化 HTML 流：所有可重排格式统一归一化到此结构 */
export interface Chapter {
  title: string;
  html: string;
  chars: number;
  level?: number;
}

export interface Progress {
  chapter: number;
  page: number;
  pages: number;
  pct: number;
  updatedAt: number;
}

export interface CatNode {
  id: string;
  parentId: string | null;
  name: string;
  updatedAt?: number;
}

export type Flow = 'horizontal' | 'vertical';
export type FontFamily = 'serif' | 'kai' | 'sans';
export type TapDir = 'auto' | 'ltr';
export type ConvMode = 'off' | 's2t' | 't2s' | 's2tw' | 'tw2s';
export type TextAlign = 'justify' | 'start';
export type HlStyle = 'bg' | 'underline' | 'wavy';
/** 阅读模式：paged=分页翻页（横竖排引擎）；scroll=上下滚动（仅横排可用） */
export type ReadMode = 'paged' | 'scroll';
/** 界行/版框颜色：auto=跟随主题发丝色，其余为传统印刷色 */
export type LineColor = 'auto' | 'ink' | 'red' | 'blue' | 'green' | 'gold';
export type ThemeName =
  | 'paper' | 'sheepskin' | 'lamp' | 'jade'
  | 'plain' | 'bean' | 'sky' | 'nightblue'
  | 'snow' | 'zitan'
  | 'custom';

export interface CustomTheme {
  bg: string;
  fg: string;
  accent: string;
  panel: string;
}

export interface ReaderSettings {
  flow: Flow;
  fontFamily: string; // 'serif' | 'kai' | 'sans' | 'fang' | 'custom:<fontId>'
  fontSize: number;
  lineHeight: number;
  letterSpacing: number; // em
  paraSpacing: number; // em（段间距）
  pageMarginX: number; // 左右边距（px）
  pageMarginY: number; // 上下边距（px）
  colsPerPage: 1 | 2; // 双页对开（仅横排生效）
  theme: ThemeName;
  customTheme: CustomTheme;
  tapDir: TapDir;
  conv: ConvMode;
  indent: boolean; // 首行缩进两字
  align: TextAlign; // 两端对齐 / 齐左
  fontWeight: 400 | 600; // 字重
  brightness: number; // 40-100（%）
  warmth: number; // 0-60 夜间暖色
  texture: boolean; // 纸张纹理
  hlStyle: HlStyle; // 划线样式：高亮 / 直线 / 波浪
  decorLines: boolean; // 界行：竖排列间细线
  decorFrame: boolean; // 版框：页面边框（可与界行同开）
  lineColor: LineColor; // 界行/版框颜色
  keepBookCss: boolean; // 保留原书排版（EPUB 内嵌样式）；关闭=统一古典换肤
  readMode: ReadMode; // 分页 / 滚动（滚动仅横排）
  showHeader: boolean; // 页眉：章节名（常显）
  showFooter: boolean; // 页脚：进度 · 页码 · 时间（常显）
}

export type HighlightColor = 'red' | 'green' | 'blue' | 'amber';

/** 划线/批注/书签：以文本引语（前后文+引语）锚定，全格式统一，重排版可重挂 */
export interface Annotation {
  id: string;
  bookId: string;
  kind: 'highlight' | 'bookmark';
  chapter: number;
  exact: string;
  prefix: string;
  suffix: string;
  color: HighlightColor;
  note: string;
  ratio?: number;
  conv?: ConvMode;
  updatedAt?: number;
  createdAt: number;
}
