import { Panel } from './Panel';
/** TTS 朗读面板（V0.3.1）：系统语音合成，语速/音色/定时停止/自动连播 */
import { useEffect } from 'react';
import { isZhLang, tts, useTts } from '../engine/tts';

export function TtsPanel({
  onStart,
  onClose,
}: {
  /** Reader 提供：取当前章节段落并启动朗读 */
  onStart: () => void;
  onClose: () => void;
}) {
  const playing = useTts((st) => st.playing);
  const paused = useTts((st) => st.paused);
  const paras = useTts((st) => st.paras);
  const paraIdx = useTts((st) => st.paraIdx);
  const config = useTts((st) => st.config);
  const voices = useTts((st) => st.voices);
  const error = useTts((st) => st.error);
  const setConfig = useTts((st) => st.setConfig);
  const refreshVoices = useTts((st) => st.refreshVoices);

  useEffect(() => {
    refreshVoices();
  }, [refreshVoices]);

  const zhVoices = voices.filter((v) => isZhLang(v.lang));
  const otherVoices = voices.filter((v) => !isZhLang(v.lang));
  const status = playing ? (paused ? '已暂停' : '朗读中') : '未播放';
  const cur = paras[paraIdx] ?? '';
  const totalChars = paras.reduce((a, t) => a + t.length, 0);

  return (
    <Panel label="朗读" onClose={onClose}>
        <div className="drawer-head">
          <h3>朗读</h3>
          <button onClick={onClose}>完成</button>
        </div>

        <p className="panel-intro">听一卷书，歇一歇眼。</p>
        <div role="status" className={`tts-status s-${playing ? (paused ? 'paused' : 'ok') : 'off'}`}>
          {status}
          {paras.length > 0 ? ` · 第 ${paraIdx + 1}/${paras.length} 段 · 本章 ${totalChars} 字` : ''}
        </div>

        {error ? <p className="set-hint tts-error">{error}</p> : null}

        <div className="tts-para-box">
          {cur ? <p className="tts-para">{cur}</p> : <p className="set-hint">从当前章节开始，读至何处，在此显示。</p>}
        </div>

        <div className="set-group">
          <div className="seg tts-controls">
            {!playing ? (
              <button className="primary" onClick={onStart}>
                开始朗读
              </button>
            ) : paused ? (
              <button className="primary" onClick={() => tts.resume()}>
                继续
              </button>
            ) : (
              <button onClick={() => tts.pause()}>暂停</button>
            )}
            {playing ? (
              <>
                <button onClick={() => tts.nextPara()}>下一句</button>
                <button className="danger" onClick={() => tts.stop()}>
                  停止
                </button>
              </>
            ) : null}
          </div>
        </div>

        <label className="set-range">
          <span>语速 {config.rate.toFixed(1)}x</span>
          <input
            type="range"
            min={0.5}
            max={2}
            step={0.1}
            value={config.rate}
            onChange={(e) => {
              void setConfig({ rate: Number(e.target.value) });
              tts.applyLiveChange();
            }}
          />
        </label>

        <details className="panel-details"><summary>朗读偏好<span>音色、定时与连播</span></summary>
        <div className="set-group">
          <label>音色（系统提供，中文优先）</label>
          {voices.length === 0 ? (
            <p className="set-hint">
              {tts.isNative()
                ? '系统文字转语音未就绪 · 请在「设置 → 语言和输入法 → 文字转语音输出」安装中文语音包'
                : '未检测到语音引擎 · 手机需在系统设置中安装中文语音包'}
            </p>
          ) : (
            <select
              className="field" aria-label="朗读音色"
              value={config.voiceURI}
              onChange={(e) => {
                void setConfig({ voiceURI: e.target.value });
                tts.applyLiveChange();
              }}
            >
              <option value="">系统默认</option>
              {zhVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}（{v.lang}）
                </option>
              ))}
              {otherVoices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name}（{v.lang}）
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="set-group">
          <label>定时停止</label>
          <div className="seg">
            {[0, 15, 30, 60].map((m) => (
              <button
                key={m}
                className={config.stopAfterMin === m ? 'active' : ''}
                onClick={() => {
                  void setConfig({ stopAfterMin: m });
                }}
              >
                {m === 0 ? '不限' : `${m} 分钟`}
              </button>
            ))}
          </div>
          <p className="set-hint">对下一次「开始朗读」生效；朗读中修改语速/音色即时生效</p>
        </div>

        <div className="set-group">
          <label>读完本章后</label>
          <div className="seg">
            <button className={config.autoNext ? 'active' : ''} onClick={() => void setConfig({ autoNext: true })}>
              自动连播下一章
            </button>
            <button className={!config.autoNext ? 'active' : ''} onClick={() => void setConfig({ autoNext: false })}>
              停止
            </button>
          </div>
          <p className="set-hint">使用系统语音引擎，朗读不影响排版与划线；退出阅读页自动停止</p>
        </div>
        </details>
    </Panel>
  );
}
