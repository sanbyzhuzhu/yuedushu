import { useState } from 'react';
import { APP_VERSION, DEFAULT_UPDATE_SOURCE, compareVersions, openUpdateDownload, updateTarget } from '../engine/appUpdate';
import { useAppUpdate } from '../store/appUpdate';

export function UpdatePanel() {
  const state = useAppUpdate();
  const [address, setAddress] = useState(state.source);
  const [message, setMessage] = useState('');
  const [confirm, setConfirm] = useState<{ version: string; url: string } | null>(null);
  const [opening, setOpening] = useState(false);
  const target = updateTarget();
  const release = state.manifest;
  const newer = !!release && compareVersions(release.version, APP_VERSION) > 0;
  const ignored = newer && state.ignored === release.version;
  const download = target === 'unsupported' ? undefined : release?.downloads[target];
  const saveSource = () => {
    try {
      state.configure(address, state.autoCheck);
      setAddress(useAppUpdate.getState().source);
      setConfirm(null); setMessage('更新地址已保存');
    } catch (e) { setMessage(e instanceof Error ? e.message : '保存失败'); }
  };
  return <div className="update-panel">
    <p className="panel-intro">当前版本 v{APP_VERSION}。更新只在此处提示，不弹窗、不自动下载；离线也可正常阅读。</p>
    <p className="update-status" role="status">{state.checking ? '正在检查更新…' : newer
      ? `发现新版本 v${release.version}${ignored ? '（已忽略）' : ''}`
      : state.manifest ? '当前已是最新版本' : '尚未获取版本信息'}</p>
    {state.error ? <p className="set-hint" role="status">检查未完成：{state.error}。{state.manifest ? '目前展示上次获取的信息。' : '可稍后重试，不影响使用。'}</p> : null}
    {state.checkedAt ? <p className="set-hint">上次检查：{new Date(state.checkedAt).toLocaleString('zh-CN')}</p> : null}
    <button className="primary" disabled={state.checking} onClick={() => { setMessage(''); void state.check(true); }}>{state.checking ? '正在检查…' : '立即检查更新'}</button>
    {newer ? <section className="update-release" aria-label="新版本详情">
      <h3>阅读树 v{release.version}</h3>
      {release.publishedAt ? <p className="set-hint">发布时间：{release.publishedAt}</p> : null}
      <p className="update-notes">{release.notes || '本次更新未填写说明。'}</p>
      {download ? <>
        <p className="set-hint">{target === 'android' ? '安卓 APK' : 'Windows 64 位安装包'} · 下载后由系统确认安装，建议覆盖升级。</p>
        {confirm ? <div className="update-confirm" aria-label="确认更新">
          <p>确认打开 v{confirm.version} 的更新下载地址？</p>
          <p className="update-address">{confirm.url}</p>
          <p className="set-hint">将在系统浏览器中下载。下载完成后打开安装包，按系统提示完成升级。</p>
          <button disabled={opening} className="primary" onClick={() => {
            setOpening(true); setMessage('');
            void openUpdateDownload(confirm.url).then(() => {
              setMessage('已请求打开下载地址，请在系统浏览器中继续下载。'); setConfirm(null);
            }).catch(e => setMessage(e instanceof Error ? e.message : '打开下载失败')).finally(() => setOpening(false));
          }}>{opening ? '正在打开…' : '确认打开下载'}</button>
          <button disabled={opening} onClick={() => setConfirm(null)}>暂不更新</button>
        </div> : <button onClick={() => { setConfirm({ version: release.version, url: download }); setMessage(''); }}>下载更新</button>}
      </> : <p className="set-hint">本设备暂无对应安装包，当前版本可继续使用。</p>}
      {ignored ? <button onClick={() => state.unignore()}>恢复此版本提示</button>
        : <button onClick={() => { state.ignore(); setConfirm(null); setMessage('已忽略此版本，后续新版本仍会提示'); }}>忽略此版本</button>}
    </section> : null}
    <div className="set-group update-options">
      <label><input type="checkbox" checked={state.autoCheck} onChange={e => {
        state.configure(state.source, e.target.checked); setConfirm(null);
      }} />后台检查新版本（每天最多一次，仅红点提示）</label>
    </div>
    <details className="update-options"><summary>更新来源设置</summary>
      <label htmlFor="update-source">公开的 update.json 地址</label>
      <input id="update-source" className="field" type="url" value={address} onChange={e => setAddress(e.target.value)} spellCheck={false} />
      <button onClick={saveSource}>保存更新地址</button>
      <button onClick={() => setAddress(DEFAULT_UPDATE_SOURCE)}>填入默认 Gitee 地址</button>
      <p className="set-hint">默认仓库：sanbyzhu/yuedushu。首次发布需创建公开仓库并上传 update.json 与安装包。若使用 main 分支，请将地址中的 master 改为 main。</p>
    </details>
    {state.storageError ? <p role="status">{state.storageError}</p> : null}
    {message ? <p role="status">{message}</p> : null}
  </div>;
}
