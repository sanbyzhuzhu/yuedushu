import {create} from 'zustand';
export type WifiFile = {id:string;name:string;size:number;received:number;status:'receiving'|'queued'|'importing'|'imported'|'failed';message:string};
export type WifiSnapshot = {revision:number;running:boolean;urls:string[];code:string;transfers:WifiFile[]};
export const wifiAvailable = () => '__TAURI_INTERNALS__' in window;
export async function wifiCall<T>(command:string,args:Record<string,unknown>={}):Promise<T>{
  const {invoke}=await import('@tauri-apps/api/core');return invoke<T>(command,args);
}
type WifiStore = WifiSnapshot & {busy:boolean;error:string;load:()=>Promise<void>;start:()=>Promise<void>;stop:()=>Promise<void>};
const initial:WifiSnapshot={revision:0,running:false,urls:[],code:'',transfers:[]};
export function applyWifiSnapshot(snapshot:WifiSnapshot){if(snapshot.revision>=useWifiTransfer.getState().revision)useWifiTransfer.setState(snapshot);}
export const useWifiTransfer=create<WifiStore>((set,get)=>({
  ...initial,busy:false,error:'',
  load:async()=>{if(!wifiAvailable())return;try{applyWifiSnapshot(await wifiCall<WifiSnapshot>('wifi_state'));}catch(e){set({error:String(e)});}},
  start:async()=>{
    if(get().busy||get().running)return;
    set({busy:true,error:''});try{applyWifiSnapshot(await wifiCall<WifiSnapshot>('wifi_start'));}catch(e){set({error:String(e)});}finally{set({busy:false});}
  },
  stop:async()=>{
    if(get().busy)return;
    set({busy:true,error:''});try{applyWifiSnapshot(await wifiCall<WifiSnapshot>('wifi_stop'));}catch(e){set({error:String(e)});}finally{set({busy:false});}
  },
}));
