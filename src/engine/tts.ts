/** TTS 朗读引擎
 *  V0.3.1：基于 Web Speech API（桌面 WebView2 / 浏览器可用）
 *  V0.3.3：新增 Android 原生 TextToSpeech 后端
 *  V0.3.4：段落切分重写 + 长段切片（见文件末尾 chapterParas）+ 失败不再静默跳过
 *
 *  为什么需要双后端：Android WebView 不提供 Web Speech API 的 speechSynthesis
 *  （'speechSynthesis' in window 为 false，朗读点了完全没反应）。
 *  Android 壳里 MainActivity 通过 addJavascriptInterface 注入 window.ReadingTreeNativeTts，
 *  因此这里「原生优先、Web Speech 兜底」；两端对外接口完全一致。
 *  朗读不改 DOM，不影响分页与划线。
 */
import { create } from 'zustand';
import { platform } from '../platform/web';

export interface TtsConfig {
  rate: number; // 0.5 - 2
  voiceURI: string; // 空 = 系统默认中文音色
  stopAfterMin: number; // 0 = 不限时
  autoNext: boolean; // 读完自动连播下一章
}

const DEFAULTS: TtsConfig = { rate: 1, voiceURI: '', stopAfterMin: 0, autoNext: true };

interface TtsState {
  playing: boolean;
  paused: boolean;
  paras: string[];
  paraIdx: number;
  config: TtsConfig;
  voices: SpeechSynthesisVoice[];
  /** 最近一次朗读异常（面板展示，正常朗读时为空） */
  error: string;
  setConfig: (patch: Partial<TtsConfig>) => Promise<void>;
  refreshVoices: () => void;
}

// ---------- Android 原生桥 ----------

interface NativeTtsBridge {
  isReady(): boolean;
  hasChinese(): boolean;
  getEngineName(): string;
  getVoices(): string; // JSON: [{id,name,lang}]
  setVoice(id: string): boolean;
  speak(text: string, id: string, rate: number): void;
  stop(): void;
}

function nativeBridge(): NativeTtsBridge | null {
  const b = (window as unknown as { ReadingTreeNativeTts?: NativeTtsBridge }).ReadingTreeNativeTts;
  return b && typeof b.speak === 'function' ? b : null;
}

let nativeReady = false;
let nativeHasChinese = false;

/** 是否走原生 TTS */
function useNative(): boolean {
  return nativeReady;
}

/** 中文语系判定：Android 的 TextToSpeech 中文 locale 常报 cmn-CN / zho */
export function isZhLang(lang: string): boolean {
  const l = (lang || '').toLowerCase();
  return l.startsWith('zh') || l.startsWith('cmn') || l.startsWith('zho');
}

function readNativeVoices(): SpeechSynthesisVoice[] {
  const b = nativeBridge();
  if (!b || !nativeReady) return [];
  try {
    const arr = JSON.parse(b.getVoices() || '[]') as { id: string; name: string; lang: string }[];
    return arr.map(
      (v) =>
        ({
          voiceURI: v.id,
          name: v.name,
          lang: v.lang,
          localService: true,
          default: false,
        }) as unknown as SpeechSynthesisVoice,
    );
  } catch {
    return [];
  }
}

export const useTts = create<TtsState>((set, get) => ({
  playing: false,
  paused: false,
  paras: [],
  paraIdx: 0,
  config: DEFAULTS,
  voices: [],
  error: '',

  setConfig: async (patch) => {
    const config = { ...get().config, ...patch };
    set({ config });
    await platform.kvSet('tts-config', config);
  },

  refreshVoices: () => {
    if (useNative()) {
      set({ voices: readNativeVoices() });
      return;
    }
    if (!('speechSynthesis' in window)) return;
    const all = window.speechSynthesis.getVoices();
    // 中文音色排前，其余附后（供非中文书使用）
    const sorted = [...all].sort((a, b) => (isZhLang(a.lang) ? 0 : 1) - (isZhLang(b.lang) ? 0 : 1));
    set({ voices: sorted });
  },
}));

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

// 原生事件回调（Kotlin 经 evaluateJavascript 调用）；必须先于异步初始化注册
(window as unknown as Record<string, unknown>).__rtTtsNativeEvent = (type: string, id: string) => {
  if (type === 'ready') {
    nativeReady = id === '1';
    if (nativeReady) {
      nativeHasChinese = nativeBridge()?.hasChinese() ?? false;
      useTts.getState().refreshVoices();
    }
    return;
  }
  if (type !== 'done' && type !== 'error') return;
  // 已停止/暂停 → 丢弃在途回调（原生 stop 也会触发 onError）
  const st = useTts.getState();
  if (!st.playing || st.paused) return;
  if (pendingGen !== gen || id !== pendingId) return;
  clearWatchdog();
  if (type === 'error') {
    // 原生引擎拒绝了这一段（超长文本、解码失败、引擎异常）。
    // V0.3.4 前这里静默跳过——整章正文被引擎拒收时表现为「只读了标题就跳下一章」。
    errStreak += 1;
    if (errStreak >= 3) {
      stopAll();
      useTts.setState({ error: '语音引擎连续朗读失败，已停止；可在系统设置里更换「文字转语音」引擎' });
      return;
    }
    useTts.setState({ error: '语音引擎未能朗读上一段（已跳过）' });
  } else {
    errStreak = 0;
    if (st.error) useTts.setState({ error: '' });
  }
  qi += 1;
  speakNext();
};

// 启动即：恢复配置 → 探测后端 → 填充音色列表
void (async () => {
  const saved = await platform.kvGet<Partial<TtsConfig>>('tts-config');
  if (saved) useTts.setState({ config: { ...DEFAULTS, ...saved } });

  const bridge = nativeBridge();
  if (bridge) {
    // TextToSpeech 初始化是异步的，最多轮询 4s
    for (let i = 0; i < 40; i++) {
      try {
        if (bridge.isReady()) {
          nativeReady = true;
          break;
        }
      } catch {
        /* ignore */
      }
      await wait(100);
    }
    if (nativeReady) {
      nativeHasChinese = bridge.hasChinese();
      useTts.getState().refreshVoices();
      return;
    }
  }

  if ('speechSynthesis' in window) {
    useTts.getState().refreshVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', () => useTts.getState().refreshVoices());
  }
})();

// 调试观测点（自动化测试用）
(window as unknown as Record<string, unknown>).__rtTtsState = () => {
  const st = useTts.getState();
  return {
    playing: st.playing,
    paused: st.paused,
    paras: st.paras.length,
    voices: st.voices.length,
    native: nativeReady,
    nativeZh: nativeHasChinese,
    error: st.error,
  };
};

// 段落切分观测点（自动化测试用）：可直接喂 HTML 看切分结果
(window as unknown as Record<string, unknown>).__rtChapterParas = (html: string, max?: number) =>
  chapterParas(html, max);

// ---------- 播放控制器 ----------

let queue: string[] = [];
let qi = 0;
let gen = 0; // 代际计数：stop/skip/pause 后忽略在途回调
let stopAt = 0;
let endCb: (() => void) | null = null;
let pendingGen = -1; // 原生：当前在途 utterance 的代际与 id
let pendingId = '';
let errStreak = 0; // 连续朗读失败段数
let watchdog: ReturnType<typeof setTimeout> | undefined;

function clearWatchdog(): void {
  if (watchdog) {
    clearTimeout(watchdog);
    watchdog = undefined;
  }
}

/** 原生引擎偶发「既无 onDone 也无 onError」的静默挂起：按文本长度给足上限，超时按失败推进。
 *  正常朗读 200 字约 20-40 秒，这里留 10s + 0.6s/字，绝不误杀。 */
function armWatchdog(g: number, id: string, text: string): void {
  clearWatchdog();
  watchdog = setTimeout(
    () => {
      watchdog = undefined;
      const st = useTts.getState();
      if (g !== gen || !st.playing || st.paused || pendingId !== id) return;
      errStreak += 1;
      if (errStreak >= 3) {
        stopAll();
        useTts.setState({ error: '语音引擎无响应，已停止朗读；请检查系统「文字转语音输出」设置' });
        return;
      }
      useTts.setState({ error: '语音引擎无响应（已跳过该段）' });
      qi += 1;
      speakNext();
    },
    10000 + text.length * 600,
  );
}

/** 停止并清空队列（内部使用，供事件回调/看门狗复用） */
function stopAll(): void {
  gen += 1;
  clearWatchdog();
  if (useNative()) nativeBridge()?.stop();
  else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  queue = [];
  qi = 0;
  stopAt = 0;
  endCb = null;
  errStreak = 0;
  pendingId = '';
  useTts.setState({ playing: false, paused: false, paras: [], paraIdx: 0 });
}

function speakNext(): void {
  const g = gen;
  if (qi >= queue.length) {
    clearWatchdog();
    useTts.setState({ playing: false, paused: false });
    const cb = endCb;
    endCb = null;
    cb?.();
    return;
  }
  const cfg = useTts.getState().config;
  if (cfg.stopAfterMin > 0 && stopAt && Date.now() > stopAt) {
    tts.stop();
    return;
  }
  useTts.setState({ paraIdx: qi, playing: true, paused: false });
  const text = queue[qi];

  if (useNative()) {
    const b = nativeBridge();
    if (b) {
      pendingGen = g;
      pendingId = String(qi);
      try {
        if (cfg.voiceURI) b.setVoice(cfg.voiceURI);
        b.speak(text, pendingId, cfg.rate);
        armWatchdog(g, pendingId, text);
        return;
      } catch {
        /* 原生调用异常 → 跳过该段继续 */
      }
    }
    errStreak += 1;
    if (errStreak >= 3) {
      stopAll();
      useTts.setState({ error: '语音引擎调用失败，已停止朗读' });
      return;
    }
    qi += 1;
    speakNext();
    return;
  }

  if (!('speechSynthesis' in window)) return;
  const u = new SpeechSynthesisUtterance(text);
  u.rate = cfg.rate;
  u.lang = 'zh-CN';
  const v = useTts.getState().voices.find((x) => x.voiceURI === cfg.voiceURI);
  if (v) u.voice = v;
  u.onend = () => {
    if (g !== gen) return;
    qi += 1;
    speakNext();
  };
  u.onerror = () => {
    if (g !== gen) return;
    qi += 1; // 单段出错跳过继续
    speakNext();
  };
  window.speechSynthesis.speak(u);
}

function restartCurrent(): void {
  if (!useTts.getState().playing) return;
  gen += 1;
  clearWatchdog();
  if (useNative()) nativeBridge()?.stop();
  else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
  setTimeout(() => {
    if (useTts.getState().playing && !useTts.getState().paused) speakNext();
  }, 90);
}

export const tts = {
  available(): boolean {
    return useNative() || 'speechSynthesis' in window;
  },

  /** 是否使用 Android 原生 TTS（UI 提示文案用） */
  isNative(): boolean {
    return useNative();
  },

  /** 原生模式下系统是否有中文语音数据 */
  nativeHasChinese(): boolean {
    return nativeHasChinese;
  },

  /** 开始朗读一段文字（段落数组） */
  start(paras: string[], onQueueEnd?: () => void): void {
    if (!this.available() || paras.length === 0) return;
    gen += 1;
    clearWatchdog();
    if (useNative()) nativeBridge()?.stop();
    else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    queue = paras;
    qi = 0;
    errStreak = 0;
    stopAt = useTts.getState().config.stopAfterMin > 0 ? Date.now() + useTts.getState().config.stopAfterMin * 60000 : 0;
    endCb = onQueueEnd ?? null;
    useTts.setState({ paras, paraIdx: 0, error: '' });
    speakNext();
  },

  pause(): void {
    if (!this.available()) return;
    gen += 1; // 在途回调失效
    clearWatchdog();
    if (useNative()) nativeBridge()?.stop(); // Android 无 pause：停掉，resume 时重读当前段
    else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    useTts.setState({ paused: true });
  },

  resume(): void {
    if (!this.available()) return;
    useTts.setState({ paused: false });
    if (useNative()) {
      speakNext(); // 从当前段落重读
      return;
    }
    // pause invalidated the old utterance callbacks: enqueue a fresh current sentence.
    if ('speechSynthesis' in window) { window.speechSynthesis.resume(); speakNext(); }
  },

  stop(): void {
    if (!this.available()) return;
    stopAll();
  },

  /** 跳到下一段 */
  nextPara(): void {
    if (qi >= queue.length - 1) return;
    gen += 1;
    clearWatchdog();
    if (useNative()) nativeBridge()?.stop();
    else if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    qi += 1;
    errStreak = 0;
    setTimeout(() => speakNext(), 90);
  },

  /** 语速/音色变化后，从当前段落以新参数续读 */
  applyLiveChange(): void {
    restartCurrent();
  },
};

/** 从章节 HTML 提取朗读段落：块级元素逐段、`<br>` 断行、长段再切片。
 *
 *  V0.3.4 重写。旧实现用固定选择器 `p,h1..h6,li,blockquote,div` 一次性取块，有两个致命问题：
 *  ① 容器与其内部块级元素同时入选（祖先 div 在文档序中排在子元素之前），于是「整章文本」
 *     被当成第一段——既是重复朗读，又远超引擎上限；
 *  ② 正文若不在上述标签里（裸文本 + `<br>`、`<section>`、`<td>`、未知容器），一段都取不到，
 *     只剩标题可读，表现为「只朗读章节标题就跳下一章」。
 *
 *  新算法递归下钻：遇到块级容器就继续往里找，只把「叶子块」当段落，内联内容按 `<br>` 断行累积。
 *  最后统一切片：超长段按句切片、相邻短段合并到接近上限，保证单段既不超长（引擎拒收）
 *  也不碎片化（每段都要重新起播，几十字一段会有明显停顿）。 */

/** 块级标签：递归下钻的分界（内联标签的文字并入当前段） */
const BLOCK_TAGS = new Set([
  'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'BODY', 'CAPTION', 'CENTER', 'DD', 'DETAILS',
  'DIALOG', 'DIV', 'DL', 'DT', 'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2',
  'H3', 'H4', 'H5', 'H6', 'HEADER', 'HGROUP', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
  'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL',
]);

/** 直接丢弃（不含朗读内容，且 textContent 可能混入代码/样式） */
const DROP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);

/** 单段朗读上限（字符）。Android TextToSpeech 单次输入上限 4000，超限直接报错；
 *  取值也要兼顾「暂停 = 重读当前段」的代价：200 字约 30-40 秒。 */
export const MAX_SPEAK_CHARS = 200;

const HARD_BREAK = '，、,：:';

/** 按句末标点断句（连同其后的引号/括号一起收在句尾） */
function splitSentences(text: string): string[] {
  const END = '。！？!?…；;';
  const TAIL = '」』”"’）)】》〉';
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!END.includes(text[i])) continue;
    let j = i + 1;
    while (j < text.length && TAIL.includes(text[j])) j++;
    out.push(text.slice(start, j));
    start = j;
    i = j - 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out.filter((s) => s.trim());
}

/** 单句仍超长时的硬切：优先在逗号/顿号处断 */
function hardSlice(s: string, max: number): string[] {
  const out: string[] = [];
  let rest = s;
  while (rest.length > max) {
    let cut = -1;
    for (let i = Math.min(max, rest.length - 1); i > Math.floor(max * 0.5); i--) {
      if (HARD_BREAK.includes(rest[i])) {
        cut = i + 1;
        break;
      }
    }
    if (cut <= 0) cut = max;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}

/** 长文本切片：先按句聚合到不超过 max，单句超长再硬切 */
export function splitLong(text: string, max = MAX_SPEAK_CHARS): string[] {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return [];
  if (t.length <= max) return [t];
  const out: string[] = [];
  let buf = '';
  for (const s of splitSentences(t)) {
    if (s.length > max) {
      if (buf.trim()) out.push(buf.trim());
      buf = '';
      out.push(...hardSlice(s, max));
      continue;
    }
    if (buf.length + s.length > max) {
      if (buf.trim()) out.push(buf.trim());
      buf = s;
    } else {
      buf += s;
    }
  }
  if (buf.trim()) out.push(buf.trim());
  return out.map((s) => s.trim()).filter(Boolean);
}

interface Atom {
  text: string;
  heading: boolean;
}

/** 递归采集叶子块文字（标题单独成项，便于不与正文混读） */
function walkBlocks(root: Element, out: Atom[], inHeading = false): void {
  let buf = '';
  const flush = () => {
    const t = buf.replace(/\s+/g, ' ').trim();
    buf = '';
    if (t) out.push({ text: t, heading: inHeading });
  };
  for (const node of Array.from(root.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      buf += node.textContent ?? '';
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const el = node as Element;
    const tag = el.tagName;
    if (DROP_TAGS.has(tag)) continue;
    if (tag === 'BR' || tag === 'HR') {
      flush();
      continue;
    }
    if (BLOCK_TAGS.has(tag)) {
      flush();
      walkBlocks(el, out, inHeading || /^H[1-6]$/.test(tag));
      continue;
    }
    buf += el.textContent ?? ''; // 内联元素并入当前段
  }
  flush();
}

/** 短段合并：原生引擎每段都要重新起播，几十字一段会有明显停顿；
 *  把相邻正文合并到接近 max，标题与超长段各自独立。 */
function packAtoms(atoms: Atom[], max: number): string[] {
  const out: string[] = [];
  let buf = '';
  const flush = () => {
    const t = buf.trim();
    buf = '';
    if (t) out.push(t);
  };
  for (const a of atoms) {
    if (a.heading || a.text.length > max) {
      flush();
      out.push(...splitLong(a.text, max));
      continue;
    }
    if (buf.length + a.text.length > max) flush();
    buf += a.text;
  }
  flush();
  return out;
}

export function chapterParas(html: string, max = MAX_SPEAK_CHARS, sentenceBySentence = false): string[] {
  const split = (text: string) => sentenceBySentence
    ? splitSentences(text.replace(/\s+/g, ' ').trim()).flatMap((s) => hardSlice(s.trim(), max)).filter(Boolean)
    : splitLong(text, max);
  try {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const body = doc.body;
    if (!body) return [];
    const atoms: Atom[] = [];
    walkBlocks(body, atoms);
    if (atoms.length) return sentenceBySentence ? atoms.flatMap((a) => split(a.text)) : packAtoms(atoms, max);
    const whole = (body.textContent ?? '').replace(/\s+/g, ' ').trim();
    return whole ? split(whole) : [];
  } catch {
    const t = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return t ? split(t) : [];
  }
}
