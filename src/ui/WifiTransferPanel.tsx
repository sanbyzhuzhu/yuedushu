import {useEffect,useRef,useState} from 'react';
import {Panel} from './Panel';
import {useLibrary} from '../store/library';
import {applyWifiSnapshot,useWifiTransfer,wifiAvailable,wifiCall} from '../store/wifiTransfer';
import type {WifiSnapshot} from '../store/wifiTransfer';
import {copyText} from '../engine/clipboard';
import '../styles/wifiTransfer.css';
const labels={receiving:'正在接收',queued:'等待入架',importing:'正在入架',imported:'已入架',failed:'未完成'};
export function WifiTransferPanel({onClose}:{onClose:()=>void}){
  const state=useWifiTransfer();const ready=useLibrary(s=>s.ready);const [message,setMessage]=useState('');
  const mounted=useRef(true);
  const stopNative=()=>wifiCall<WifiSnapshot>('wifi_stop').then(applyWifiSnapshot).catch(e=>useWifiTransfer.setState({error:String(e)}));
  useEffect(()=>{mounted.current=true;void useWifiTransfer.getState().load();return()=>{
    mounted.current=false;if(wifiAvailable())void stopNative();
  };},[]);
  const start=async()=>{await state.start();if(!mounted.current)await stopNative();};
  const close=()=>{if(state.busy)return;if(!wifiAvailable()||!state.running){onClose();return;}void state.stop().then(()=>{if(!useWifiTransfer.getState().running)onClose();});};
  const copy=async(text:string)=>{try{await copyText(text);setMessage('已复制');}catch{setMessage('复制未完成，可长按地址手动复制');}};
  return <Panel label="Wi-Fi 传书" onClose={close}>
    <div className="drawer-head"><h3>Wi-Fi 传书</h3><button disabled={state.busy} onClick={close}>关闭</button></div>
    <p className="panel-intro">在另一台手机或电脑的浏览器中选书，直接送进阅读树。</p>
    <p className="set-hint">两台设备需连接同一局域网，可使用 Wi-Fi、网线或手机热点。接收期间请保持阅读树在前台，不要锁屏。</p>
    {!wifiAvailable()?<p className="panel-empty">请使用电脑版或安卓版阅读树接收，网页版暂不支持开启接收服务。</p>:<>
      <p role="status">{state.running?'正在等待传书':'传书尚未开启'}</p>
      {!state.running?<button className="primary" disabled={state.busy||!ready} onClick={()=>void start()}>{state.busy?'正在开启…':'开启 Wi-Fi 传书'}</button>:<>
        <section className="wifi-addresses" aria-label="传书地址"><p>在发送设备的浏览器中打开以下地址：</p>
          {state.urls.map(url=><div key={url}><code>{url}</code><button onClick={()=>void copy(url)}>复制地址</button></div>)}
          <p className="set-hint">有多个地址时，请选与发送设备同网段的地址。无法打开时检查是否处于访客网络；Windows 若出现防火墙提示，请允许专用网络访问。</p>
        </section>
        <label className="wifi-code">本次配对码<strong>{state.code}</strong></label>
        <div className="network-actions"><button onClick={()=>void copy(`阅读树 Wi-Fi 传书\n${state.urls.join('\n')}\n配对码：${state.code}`)}>复制连接信息</button><button disabled={state.busy} onClick={()=>void state.stop()}>{state.busy?'正在停止…':'停止接收'}</button></div>
      </>}
      <p className="set-hint">支持批量发送，单本最多 256 MiB。传输只在局域网进行；请在可信网络使用。关闭此页会停止接收，未完成的上传需要重传，已经完整收到的书会继续入架。</p>
      {state.transfers.length?<section aria-label="接收记录" className="wifi-records"><h4>接收记录</h4>{[...state.transfers].reverse().map(file=><div key={file.id}>
        <strong>{file.name}</strong><span>{labels[file.status]}{file.status==='receiving'?` · ${(file.received/1048576).toFixed(1)} / ${(file.size/1048576).toFixed(1)} MB`:''}</span>
        {file.status==='receiving'?<progress aria-label={`接收 ${file.name}`} value={file.received} max={file.size}/>:null}
        {file.message?<small>{file.message}</small>:null}
      </div>)}</section>:null}
    </>}
    {state.error?<p role="alert" className="network-error">{state.error}</p>:null}{message?<p role="status">{message}</p>:null}
  </Panel>;
}
