import { Panel } from './Panel';
/** 排版设置面板（V0.1.1 / V0.2.3 扩充）：参考 Readest/Anx Reader——
 *  作用范围、双栏对开、字距段距、首行缩进/对齐/字重、亮度色温、纸张纹理、
 *  10 预设主题 + 自定义取色、划线三种样式、自定义字体导入 */
import { useRef, useState } from 'react';
import { useSettings } from '../store/settings';
import type { LineColor, ReaderSettings, ThemeName } from '../engine/types';

/** 界行/版框颜色（传统印刷色） */
const LINE_COLORS: Array<[LineColor, string, string]> = [
  ['auto', '跟随主题', 'linear-gradient(135deg, #8a8378, #c9c2b4)'],
  ['ink', '墨', 'rgba(58, 54, 48, 0.75)'],
  ['red', '朱砂', 'rgba(176, 58, 46, 0.75)'],
  ['blue', '黛蓝', 'rgba(44, 95, 124, 0.75)'],
  ['green', '苔绿', 'rgba(91, 107, 58, 0.78)'],
  ['gold', '金褐', 'rgba(166, 124, 46, 0.8)'],
];

const THEMES: Array<[ThemeName, string]> = [
  ['paper', '宣纸'],
  ['sheepskin', '羊皮'],
  ['plain', '素白'],
  ['snow', '素雪'],
  ['bean', '豆沙'],
  ['sky', '天青'],
  ['jade', '墨玉'],
  ['zitan', '紫檀'],
  ['lamp', '青灯'],
  ['nightblue', '玄夜'],
];

const FONT_PRESETS: Array<[string, string]> = [
  ['serif', '宋体'],
  ['kai', '楷体'],
  ['sans', '黑体'],
  ['fang', '仿宋'],
];

export interface SettingsPanelProps {
  s: ReaderSettings;
  onChange: (patch: Partial<ReaderSettings>) => void;
  scope: 'global' | 'book';
  onScopeChange: (scope: 'global' | 'book') => void;
  hasOverride: boolean;
  onClearOverride: () => void;
  onClose: () => void;
}

export function SettingsPanel(props: SettingsPanelProps) {
  const { s, onChange, scope, onScopeChange, hasOverride, onClearOverride, onClose } = props;
  const fonts = useSettings((st) => st.fonts);
  const saveError = useSettings(st => st.saveError);
  const keepBookCss = s.keepBookCss;
  const importFont = useSettings((st) => st.importFont);
  const deleteFont = useSettings((st) => st.deleteFont);
  const fontInput = useRef<HTMLInputElement>(null);

  const [tab, setTab] = useState('常用');
  const [fontError, setFontError] = useState('');

  const pick = (t: ThemeName) => onChange({ theme: t });

  return (
    <Panel label="排版设置" onClose={onClose}>
        <input
          ref={fontInput}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,.ttc"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) {
              try {
                setFontError('');
                const id = await importFont(f);
                onChange({ fontFamily: `custom:${id}` });
              } catch { setFontError('字体无法导入，请检查文件格式。'); }
            }
            if (fontInput.current) fontInput.current.value = '';
          }}
        />

        <div className="drawer-head">
          <h3>排版设置</h3>
          <button onClick={onClose}>完成</button>
        </div>
        {saveError ? <p role="alert">{saveError} <button onClick={() => useSettings.getState().set({})}>重试保存</button></p> : null}

        <div className="set-group">
          <label>作用范围</label>
          <div className="seg">
            <button className={scope === 'global' ? 'active' : ''} onClick={() => onScopeChange('global')}>
              跟随全局
            </button>
            <button className={scope === 'book' ? 'active' : ''} onClick={() => onScopeChange('book')}>
              本书独立
            </button>
          </div>
          <p className="set-hint">
            {scope === 'book'
              ? '以下修改只影响当前这本书，重开自动恢复'
              : '作为其他书籍的默认阅读方案'}
            {hasOverride && scope === 'global' ? ' · 本书有独立设置' : ''}
          </p>
          {hasOverride ? (
            <button className="link-btn" onClick={onClearOverride}>
              恢复全局方案
            </button>
          ) : null}
        </div>

        <div className="panel-tabs" role="tablist" aria-label="排版分组">
          {['常用', '纸墨', '版式', '更多'].map((name) => <button key={name} role="tab" aria-selected={tab === name} onClick={() => setTab(name)}>{name}</button>)}
        </div>
        <div role="tabpanel" aria-label="常用" hidden={tab !== '常用'}>
        <div className="reading-presets" aria-label="阅读预设">
          <button onClick={() => onChange({ flow: 'horizontal', readMode: 'paged', fontFamily: 'serif', fontSize: 19, lineHeight: 1.9, letterSpacing: 0, paraSpacing: .55, colsPerPage: 1, decorLines: false, decorFrame: false })}><strong>舒朗</strong><span>宋体 · 横排</span></button>
          <button onClick={() => onChange({ flow: 'vertical', readMode: 'paged', fontFamily: 'kai', fontSize: 21, lineHeight: 1.9, letterSpacing: .04, decorLines: true, decorFrame: true })}><strong>古籍</strong><span>楷体 · 竖排</span></button>
          <button onClick={() => onChange({ flow: 'horizontal', readMode: 'scroll', fontFamily: 'serif', fontSize: 22, lineHeight: 2, letterSpacing: 0, colsPerPage: 1, decorLines: false, decorFrame: false })}><strong>舒目</strong><span>大字 · 滚动</span></button>
        </div>
        <div className="set-group">
          <label>字体</label>
          <div className="seg">
            {FONT_PRESETS.map(([id, name]) => (
              <button key={id} className={s.fontFamily === id ? 'active' : ''} onClick={() => onChange({ fontFamily: id })}>
                {name}
              </button>
            ))}
          </div>
          {Object.keys(fonts).length > 0 ? (
            <div className="font-chips">
              {Object.entries(fonts).map(([id, name]) => (
                <span key={id} className={`font-chip ${s.fontFamily === `custom:${id}` ? 'active' : ''}`}>
                  <button onClick={() => onChange({ fontFamily: `custom:${id}` })}>{name}</button>
                  {s.fontFamily === `custom:${id}` ? null : (
                    <button className="chip-del" title="删除字体" onClick={() => void deleteFont(id).catch(() => setFontError('字体删除失败，请检查本地存储后重试'))}>
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          ) : null}
          <button className="link-btn" onClick={() => fontInput.current?.click()}>
            ＋ 导入字体文件（.ttf / .otf / .woff2）
          </button>
          {fontError ? <p className="form-error" role="alert">{fontError}</p> : null}
        </div>

        <label className="set-range">
          <span>字号 {s.fontSize}</span>
          <input type="range" min={12} max={56} step={1} value={s.fontSize} onChange={(e) => onChange({ fontSize: Number(e.target.value) })} />
        </label>

        <label className="set-range">
          <span>行距 {s.lineHeight.toFixed(1)}</span>
          <input type="range" min={1.4} max={2.6} step={0.1} value={s.lineHeight} onChange={(e) => onChange({ lineHeight: Number(e.target.value) })} />
        </label>

        <div className="set-group">
          <label>页面留白</label>
          <div className="seg">
            <button onClick={() => onChange({ pageMarginX: 28, pageMarginY: 36 })}>紧凑</button>
            <button onClick={() => onChange({ pageMarginX: 36, pageMarginY: 44 })}>舒适</button>
            <button onClick={() => onChange({ pageMarginX: 48, pageMarginY: 52 })}>宽松</button>
          </div>
          <p className="set-hint">在“版式”中可分别微调上下与左右边距。</p>
        </div>
        <div className="set-group">
          <label>排版方向</label>
          <div className="seg">
            <button className={s.flow === 'horizontal' ? 'active' : ''} onClick={() => onChange({ flow: 'horizontal' })}>
              横排
            </button>
            <button className={s.flow === 'vertical' ? 'active' : ''} onClick={() => onChange({ flow: 'vertical' })}>
              竖排
            </button>
          </div>
          <p className="set-hint">
            {s.flow === 'vertical' ? '自右向左读，点击左侧 / 右滑翻下一页' : '自左向右读，点击右侧 / 左滑翻下一页'}
          </p>
        </div>

        {s.flow === 'horizontal' ? (
          <div className="set-group">
            <label>阅读模式</label>
            <div className="seg">
              <button className={s.readMode !== 'scroll' ? 'active' : ''} onClick={() => onChange({ readMode: 'paged' })}>
                分页翻页
              </button>
              <button className={s.readMode === 'scroll' ? 'active' : ''} onClick={() => onChange({ readMode: 'scroll' })}>
                上下滚动
              </button>
            </div>
            <p className="set-hint">上下滚动适合长文；竖排使用分页阅读。</p>
          </div>
        ) : null}

        </div>
        <div role="tabpanel" aria-label="纸墨" hidden={tab !== '纸墨'}>
        <div className="set-group">
          <label>主题</label>
          <div className="themes">
            {THEMES.map(([k, name]) => (
              <button
                key={k}
                className={`swatch theme-${k} ${s.theme === k ? 'active' : ''}`}
                data-theme={k}
                aria-pressed={s.theme === k}
                onClick={() => pick(k)}
              >
                {name}
              </button>
            ))}
            <button
              className={`swatch theme-custom ${s.theme === 'custom' ? 'active' : ''}`}
              aria-pressed={s.theme === 'custom'}
              onClick={() => onChange({ theme: 'custom' })}
              style={{
                background: `linear-gradient(135deg, ${s.customTheme.bg} 55%, ${s.customTheme.accent} 55%)`,
                color: s.customTheme.fg,
              }}
            >
              自定义
            </button>
          </div>
          {s.theme === 'custom' ? (
            <div className="color-row">
              <label>
                背景
                <input type="color" value={s.customTheme.bg} onChange={(e) => onChange({ customTheme: { ...s.customTheme, bg: e.target.value } })} />
              </label>
              <label>
                文字
                <input type="color" value={s.customTheme.fg} onChange={(e) => onChange({ customTheme: { ...s.customTheme, fg: e.target.value } })} />
              </label>
              <label>
                点缀
                <input type="color" value={s.customTheme.accent} onChange={(e) => onChange({ customTheme: { ...s.customTheme, accent: e.target.value } })} />
              </label>
            </div>
          ) : null}
          <div className="seg" style={{ marginTop: 10 }}>
            <button className={!s.texture ? 'active' : ''} onClick={() => onChange({ texture: false })}>
              平滑背景
            </button>
            <button className={s.texture ? 'active' : ''} onClick={() => onChange({ texture: true })}>
              纸张纹理
            </button>
          </div>
        </div>

        <div className="set-group">
          <label>
            亮度与色温（仅阅读页）
            <button className="mini-reset" onClick={() => onChange({ brightness: 100, warmth: 0 })}>
              重置
            </button>
          </label>
          <label className="set-range" style={{ marginBottom: 12 }}>
            <span>亮度 {s.brightness}%</span>
            <input type="range" min={40} max={100} step={5} value={s.brightness} onChange={(e) => onChange({ brightness: Number(e.target.value) })} />
          </label>
          <label className="set-range">
            <span>夜间暖色 {s.warmth}</span>
            <input type="range" min={0} max={60} step={5} value={s.warmth} onChange={(e) => onChange({ warmth: Number(e.target.value) })} />
          </label>
          <p className="set-hint">仅影响阅读页面，可随时重置。</p>
        </div>

        <div className="set-group">
          <label>划线样式</label>
          <div className="seg">
            <button className={s.hlStyle === 'bg' ? 'active' : ''} onClick={() => onChange({ hlStyle: 'bg' })}>
              高亮
            </button>
            <button className={s.hlStyle === 'underline' ? 'active' : ''} onClick={() => onChange({ hlStyle: 'underline' })}>
              直线
            </button>
            <button className={s.hlStyle === 'wavy' ? 'active' : ''} onClick={() => onChange({ hlStyle: 'wavy' })}>
              波浪
            </button>
          </div>
          <p className="set-hint">对已有划线即时生效，颜色不变</p>
        </div>

        </div>
        <div role="tabpanel" aria-label="版式" hidden={tab !== '版式'}>
        {s.flow === 'horizontal' ? (
          <div className="set-group">
            <label>分栏</label>
            <div className="seg">
              <button className={s.colsPerPage === 1 ? 'active' : ''} onClick={() => onChange({ colsPerPage: 1 })}>
                单栏
              </button>
              <button className={s.colsPerPage === 2 ? 'active' : ''} onClick={() => onChange({ colsPerPage: 2 })}>
                双页对开
              </button>
            </div>
            <p className="set-hint">双页对开适合宽屏或横屏；竖排按行距自动分栏</p>
          </div>
        ) : null}

        <div className="set-group">
          <label>段落</label>
          <div className="seg">
            <button className={s.indent ? 'active' : ''} onClick={() => onChange({ indent: true })}>
              首行缩进
            </button>
            <button className={!s.indent ? 'active' : ''} onClick={() => onChange({ indent: false })}>
              无缩进
            </button>
            <button className={s.align === 'justify' ? 'active' : ''} onClick={() => onChange({ align: 'justify' })}>
              两端对齐
            </button>
            <button className={s.align === 'start' ? 'active' : ''} onClick={() => onChange({ align: 'start' })}>
              齐左
            </button>
          </div>
          <div className="seg" style={{ marginTop: 8 }}>
            <button className={s.fontWeight === 400 ? 'active' : ''} onClick={() => onChange({ fontWeight: 400 })}>
              标准字重
            </button>
            <button className={s.fontWeight === 600 ? 'active' : ''} onClick={() => onChange({ fontWeight: 600 })}>
              加重字重
            </button>
          </div>
        </div>

        <label className="set-range">
          <span>字间距 {s.letterSpacing.toFixed(2)}em</span>
          <input type="range" min={0} max={0.4} step={0.02} value={s.letterSpacing} onChange={(e) => onChange({ letterSpacing: Number(e.target.value) })} />
        </label>

        <label className="set-range">
          <span>段间距 {s.paraSpacing.toFixed(2)}em</span>
          <input type="range" min={0} max={1.5} step={0.05} value={s.paraSpacing} onChange={(e) => onChange({ paraSpacing: Number(e.target.value) })} />
        </label>

        <label className="set-range">
          <span>左右边距 {s.pageMarginX}</span>
          <input type="range" min={8} max={96} step={2} value={s.pageMarginX} onChange={(e) => onChange({ pageMarginX: Number(e.target.value) })} />
        </label>

        <label className="set-range">
          <span>上下边距 {s.pageMarginY}</span>
          <input type="range" min={8} max={96} step={2} value={s.pageMarginY} onChange={(e) => onChange({ pageMarginY: Number(e.target.value) })} />
        </label>

        <div className="set-group">
          <label>页眉页脚（阅读时常显）</label>
          <div className="seg">
            <button className={s.showHeader ? 'active' : ''} onClick={() => onChange({ showHeader: !s.showHeader })}>
              页眉 · 章节名 {s.showHeader ? '开' : '关'}
            </button>
            <button className={s.showFooter ? 'active' : ''} onClick={() => onChange({ showFooter: !s.showFooter })}>
              页脚 · 进度时间 {s.showFooter ? '开' : '关'}
            </button>
          </div>
          <p className="set-hint">在页边显示章节、进度和时间。</p>
        </div>

        <div className="set-group">
          <label>页面装饰（仿古籍版式，可同开）</label>
          <div className="seg">
            <button className={s.decorLines ? 'active' : ''} onClick={() => onChange({ decorLines: !s.decorLines })}>
              界行 {s.decorLines ? '开' : '关'}
            </button>
            <button className={s.decorFrame ? 'active' : ''} onClick={() => onChange({ decorFrame: !s.decorFrame })}>
              版框 {s.decorFrame ? '开' : '关'}
            </button>
          </div>
          <div className="color-row" style={{ marginTop: 10 }}>
            {LINE_COLORS.map(([v, label, css]) => (
              <label key={v} className={`line-dot ${s.lineColor === v ? 'active' : ''}`} title={label}>
                <input
                  type="radio"
                  name="lineColor"
                  aria-label={label}
                  checked={s.lineColor === v}
                  onChange={() => onChange({ lineColor: v as LineColor })}
                  className="visually-hidden"
                />
                <span className="line-dot-inner" style={{ background: css }} />
              </label>
            ))}
          </div>
          <p className="set-hint">界行：竖排列间细线；版框：环绕文字的边框。颜色可自选，默认跟随主题</p>
        </div>

        </div>
        <div role="tabpanel" aria-label="更多" hidden={tab !== '更多'}>
        <div className="set-group">
          <label>简繁转换（原文不变，仅显示层）</label>
          <div className="seg">
            <button className={s.conv === 'off' ? 'active' : ''} onClick={() => onChange({ conv: 'off' })}>
              关闭
            </button>
            <button className={s.conv === 's2t' ? 'active' : ''} onClick={() => onChange({ conv: 's2t' })}>
              简→繁
            </button>
            <button className={s.conv === 't2s' ? 'active' : ''} onClick={() => onChange({ conv: 't2s' })}>
              繁→简
            </button>
            <button className={s.conv === 's2tw' ? 'active' : ''} onClick={() => onChange({ conv: 's2tw' })}>
              简→台
            </button>
            <button className={s.conv === 'tw2s' ? 'active' : ''} onClick={() => onChange({ conv: 'tw2s' })}>
              台→简
            </button>
          </div>
          <p className="set-hint">只改变显示文字，原文与笔记保留。</p>
        </div>

        <div className="set-group">
          <label>点击翻页方向</label>
          <div className="seg">
            <button className={s.tapDir === 'auto' ? 'active' : ''} onClick={() => onChange({ tapDir: 'auto' })}>
              跟随排版
            </button>
            <button className={s.tapDir === 'ltr' ? 'active' : ''} onClick={() => onChange({ tapDir: 'ltr' })}>
              固定横排习惯
            </button>
          </div>
        </div>
        <div className="set-group">
          <label>原书排版</label>
          <div className="seg">
            <button className={keepBookCss !== false ? 'active' : ''} onClick={() => onChange({ keepBookCss: true })}>
              保留原书样式
            </button>
            <button className={keepBookCss === false ? 'active' : ''} onClick={() => onChange({ keepBookCss: false })}>
              统一排版
            </button>
          </div>
          <p className="set-hint">
            保留标题层次、强调与居中；字号、行距、字体和纸墨由阅读设置控制。切换立即生效，无需重新导入。以统一排版导入的旧书不含原书样式。
          </p>
        </div>

        </div>
    </Panel>
  );
}
