import { useState } from 'react';
import { Panel } from './Panel';
/** WebDAV 同步设置（V0.1.0 L1；V0.4.0 多账号双云端 + 服务商预设，任意标准 WebDAV 均可） */
import { useSync, newAccount, type AccountRuntime } from '../sync/sync';
import { detectPreset, WEBDAV_PRESETS } from '../sync/providers';
import type { SyncAccount } from '../sync/types';
import { WebDAVClient } from '../sync/webdav';

function fmtTime(t: number): string {
  if (!t) return '尚未同步';
  return new Date(t).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function accountStatusLabel(acc: SyncAccount, rt?: AccountRuntime): string {
  if (!acc.enabled) return '未启用';
  if (!acc.url.trim() || !acc.username.trim() || !acc.password) return '待填写';
  if (!rt) return '待同步';
  if (rt.status === 'syncing') return '同步中…';
  if (rt.status === 'error') return '同步失败';
  return `上次同步 · ${fmtTime(rt.at)}`;
}

function AccountEditor({ acc, runtime, single, onChange, onRemove }: {
  acc: SyncAccount;
  runtime?: AccountRuntime;
  single: boolean;
  onChange: (patch: Partial<SyncAccount>) => void;
  onRemove: () => void;
}) {
  // 预设选择是本组件的会话状态：用于切换时填地址、显示对应格式的提示；
  // 初始值按已填地址识别（如手动粘贴了 Nextcloud 地址则自动选中 Nextcloud）
  const [presetId, setPresetId] = useState(() => detectPreset(acc.url).id);
  const [testing, setTesting] = useState(false);
  const [testMessage, setTestMessage] = useState('');
  const preset = WEBDAV_PRESETS.find((p) => p.id === presetId) ?? WEBDAV_PRESETS[WEBDAV_PRESETS.length - 1];

  return (
    <details className="panel-details">
      <summary>{detectPreset(acc.url).label}<span>{accountStatusLabel(acc, runtime)}</span></summary>
      <div className="set-group">
        <label>参与同步</label>
        <div className="seg">
          <button className={!acc.enabled ? 'active' : ''} onClick={() => onChange({ enabled: false })}>
            关闭
          </button>
          <button className={acc.enabled ? 'active' : ''} onClick={() => onChange({ enabled: true })}>
            开启
          </button>
        </div>

        <label>服务商</label>
        <select
          className="field"
          value={presetId}
          onChange={(e) => {
            const id = e.target.value;
            setPresetId(id);
            const p = WEBDAV_PRESETS.find((x) => x.id === id);
            // 地址固定的服务商直接填入；其余清空，由占位符提示地址格式
            onChange(p?.url ? { url: p.url } : { url: '' });
          }}
        >
          {WEBDAV_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <label htmlFor={`sync-url-${acc.id}`}>服务器地址（WebDAV）</label>
        <input
          className="field"
          id={`sync-url-${acc.id}`} type="url" autoCapitalize="none" spellCheck={false}
          value={acc.url}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder={preset.placeholder}
        />
        <p className="set-hint">{preset.urlHint}</p>
        {/^(https?:\/\/)(localhost|127\.\d+\.\d+\.\d+|\[::1\])(?=[:/]|$)/i.test(acc.url.trim()) ? (
          <p className="set-hint">这是本机地址：仅连接当前设备。若服务运行在电脑上，手机或平板需改用电脑的局域网 IP，并与电脑连接同一网络。</p>
        ) : null}
        {/^http:\/\//i.test(acc.url.trim()) ? (
          <p className="set-hint">该地址为 HTTP 明文传输，账号密码与书籍数据未加密，建议仅在本机或可信局域网使用。</p>
        ) : null}

        <label htmlFor={`sync-path-${acc.id}`}>云端目录</label>
        <input
          className="field"
          id={`sync-path-${acc.id}`}
          value={acc.basePath}
          onChange={(e) => onChange({ basePath: e.target.value })}
        />

        <label htmlFor={`sync-user-${acc.id}`}>账号</label>
        <input
          className="field"
          id={`sync-user-${acc.id}`} type="text" autoCapitalize="none" autoComplete="username"
          value={acc.username}
          onChange={(e) => onChange({ username: e.target.value })}
          placeholder="邮箱或用户名"
        />

        <label htmlFor={`sync-pass-${acc.id}`}>密码 / 应用密码</label>
        <input
          className="field"
          id={`sync-pass-${acc.id}`} type="password" autoComplete="current-password"
          value={acc.password}
          onChange={(e) => onChange({ password: e.target.value })}
          placeholder="********"
        />
        <p className="set-hint">{preset.passHint} 默认保存在本机，方便自动同步；勾选下方选项后仅本次运行使用。</p>
        <label><input type="checkbox" checked={acc.rememberPassword === false} onChange={(e) => onChange({ rememberPassword: !e.target.checked })} />不记住密码</label>
        <p className="set-hint">保存的密码未加密；不记住时，重新启动后需重新填写。</p>

        <label>同时备份书籍文件</label>
        <div className="seg">
          <button className={!acc.backupBooks ? 'active' : ''} onClick={() => onChange({ backupBooks: false })}>
            关闭
          </button>
          <button className={acc.backupBooks ? 'active' : ''} onClick={() => onChange({ backupBooks: true })}>
            开启
          </button>
        </div>
        <p className="set-hint">
          开启后自动上传书籍正文与原文件到该账号（一次性消耗上行流量，换机可完整恢复）；
          从云端下载恢复始终自动进行，不耗上行。多账号时每个云各存一份，请留意流量与云盘额度。
        </p>

        {runtime?.status === 'error' && runtime.message ? <p className="set-hint sync-msg">{runtime.message}</p> : null}
        <button disabled={testing || runtime?.status === 'syncing' || !acc.url.trim() || !acc.username.trim() || !acc.password} onClick={async () => {
          setTesting(true); setTestMessage('正在测试上传、下载和清理…');
          try {
            await new WebDAVClient({ ...acc, url: acc.url.trim(), username: acc.username.trim() }).testConnection();
            setTestMessage('连接成功：已验证上传、下载及删除测试文件。');
          } catch (e) {
            setTestMessage(`连接测试失败：${e instanceof Error ? e.message : String(e)}`);
          } finally { setTesting(false); }
        }}>{testing ? '测试中…' : '测试此账号连接'}</button>
        {testMessage ? <p role="status" className="set-hint sync-msg">{testMessage}</p> : null}
        {!single ? <button onClick={onRemove}>删除此账号</button> : null}
      </div>
    </details>
  );
}

export function SyncPanel({ onClose }: { onClose: () => void }) {
  const config = useSync((st) => st.config);
  const status = useSync((st) => st.status);
  const lastSyncAt = useSync((st) => st.lastSyncAt);
  const message = useSync((st) => st.message);
  const runtime = useSync((st) => st.accountRuntime);
  const save = useSync((st) => st.save);
  const removeAccount = useSync((st) => st.removeAccount);
  const syncNow = useSync((st) => st.syncNow);

  const readyCount = config.accounts.filter((a) => a.enabled && a.url.trim() && a.username.trim() && a.password).length;

  const statusText =
    status === 'syncing' ? '同步中…' : status === 'error' ? '同步失败' : config.enabled ? (lastSyncAt ? `上次同步 · ${fmtTime(lastSyncAt)}` : '待首次同步') : '自动同步已关闭';

  return (
    <Panel label="WebDAV 同步" onClose={onClose}>
        <div className="drawer-head">
          <h3>WebDAV 同步</h3>
          <button onClick={onClose}>完成</button>
        </div>

        <p className="panel-intro">书与笔记，随身相伴。</p>
        <div role="status" className={`sync-status s-${status}`}>{statusText}</div>
        {message ? <p className="set-hint sync-msg">{message}</p> : null}

        <div className="set-group">
          <label>启用自动同步</label>
          <div className="seg">
            <button className={!config.enabled ? 'active' : ''} onClick={() => void save({ enabled: false })}>
              关闭
            </button>
            <button className={config.enabled ? 'active' : ''} onClick={() => void save({ enabled: true })}>
              开启
            </button>
          </div>
          <p className="set-hint">启动与回到前台时同步；后台暂停定时同步。</p>
          <label>同步间隔<select className="field" value={config.intervalMinutes ?? 3} onChange={e => void save({ intervalMinutes: Number(e.target.value) as 1 | 3 | 10 })}><option value={1}>1 分钟</option><option value={3}>3 分钟</option><option value={10}>10 分钟</option></select></label>
        </div>

        <div className="set-group">
          <label>云端账号</label>
          {config.accounts.map((acc) => (
            <AccountEditor
              key={acc.id}
              acc={acc}
              runtime={runtime[acc.id]}
              single={config.accounts.length === 1}
              onChange={(patch) => void save({ accounts: config.accounts.map((a) => (a.id === acc.id ? { ...a, ...patch } : a)) })}
              onRemove={() => void removeAccount(acc.id)}
            />
          ))}
          <button disabled={config.accounts.length >= 3} onClick={() => void save({ accounts: [...config.accounts, newAccount()] })}>
            添加账号
          </button>
          <p className="set-hint">可同时同步多个云盘（如坚果云 + InfiniCLOUD）互为备份；一个账号失败不影响其他账号。账号数量上限 3 个。</p>
        </div>

        <button className="primary sync-now" disabled={!config.enabled || !readyCount || status === 'syncing'} onClick={() => void syncNow()}>
          {status === 'syncing' ? '正在同步…' : '立即同步'}
        </button>

        <p className="set-hint sync-foot">
          {!config.enabled ? '开启自动同步并填写账号后，即可同步。' : '进度和笔记占用很少的流量；备份原文件时请留意云盘额度。'}
        </p>
    </Panel>
  );
}
