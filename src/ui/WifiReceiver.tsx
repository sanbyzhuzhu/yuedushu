import {useEffect} from 'react';
import {useLibrary} from '../store/library';
import {applyWifiSnapshot,useWifiTransfer,wifiAvailable,wifiCall} from '../store/wifiTransfer';
import type {WifiFile,WifiSnapshot} from '../store/wifiTransfer';
import {wifiChunkBytes} from '../platform/wifiBytes';

/** Stay mounted while navigating so a received book is acknowledged only after import commits. */
export function WifiReceiver(){
  const ready=useLibrary(state=>state.ready);
  useEffect(()=>{
    if(!ready||!wifiAvailable())return;
    let disposed=false,working=false,again=false,refreshing=false,refreshAgain=false;
    let unlisten:(()=>void)|undefined;
    const drain=async()=>{
      if(working){again=true;return;}working=true;
      try{
        do{
          again=false;
          const files=await wifiCall<WifiFile[]>('wifi_take');
          if(disposed||!files.length)break;
          for(const file of files){
            let success=false,message='';
            try{
              const chunks:BlobPart[]=[];
              for(let offset=0;offset<file.size;){
                const bytes=wifiChunkBytes(await wifiCall<unknown>('wifi_read_chunk',{id:file.id,offset}));
                if(offset+bytes.byteLength>file.size)throw Error('接收文件大小不匹配，请重新发送');
                chunks.push(bytes);offset+=bytes.byteLength;
                await new Promise(resolve=>setTimeout(resolve,0));
              }
              const book=await useLibrary.getState().importFile(new File(chunks,file.name));
              success=true;message=`已入架：《${book.title}》`;
            }catch(e){message=e instanceof Error?e.message:String(e);}
            const snapshot=await wifiCall<WifiSnapshot>('wifi_complete',{id:file.id,success,message});
            if(!disposed)applyWifiSnapshot(snapshot);
          }
          again=true;
        }while(again&&!disposed);
      }catch(e){again=false;if(!disposed)useWifiTransfer.setState({error:`接收入架未完成：${String(e)}`});}
      finally{working=false;if(again&&!disposed)queueMicrotask(()=>void drain());}
    };
    const refresh=async()=>{
      if(refreshing){refreshAgain=true;return;}refreshing=true;
      try{do{
        refreshAgain=false;
        const snapshot=await wifiCall<WifiSnapshot>('wifi_state');if(disposed)return;
        applyWifiSnapshot(snapshot);
        if(snapshot.transfers.some(file=>file.status==='queued'))void drain();
      }while(refreshAgain&&!disposed);}catch(e){if(!disposed)useWifiTransfer.setState({error:String(e)});}finally{refreshing=false;}
    };
    void import('@tauri-apps/api/event').then(async({listen})=>{
      const stop=await listen('wifi-transfer',()=>void refresh());
      if(disposed){if(typeof stop==='function')stop();}else{unlisten=stop;await refresh();}
    }).catch(e=>{if(!disposed)useWifiTransfer.setState({error:`Wi-Fi 传书暂不可用：${String(e)}`});});
    return()=>{disposed=true;unlisten?.();};
  },[ready]);
  return null;
}
