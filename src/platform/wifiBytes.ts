/** Tauri can return raw bytes as an ArrayBuffer or a JSON array on IPC fallback paths. */
export function wifiChunkBytes(value:unknown):ArrayBuffer{
  if(value instanceof ArrayBuffer){
    if(!value.byteLength||value.byteLength>262144)throw Error('接收文件分块大小无效');
    return value;
  }
  let bytes:Uint8Array;
  if(Array.isArray(value)){
    if(!value.length||value.length>262144||!value.every(n=>Number.isInteger(n)&&n>=0&&n<=255))throw Error('接收文件分块内容无效');
    bytes=Uint8Array.from(value);
  }else if(ArrayBuffer.isView(value))bytes=new Uint8Array(value.buffer,value.byteOffset,value.byteLength);
  else throw Error('无法读取接收文件分块');
  if(!bytes.byteLength||bytes.byteLength>262144)throw Error('接收文件分块大小无效');
  return Uint8Array.from(bytes).buffer;
}
