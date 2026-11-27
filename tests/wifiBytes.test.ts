import {expect,it} from 'vitest';
import {wifiChunkBytes} from '../src/platform/wifiBytes';
it('accepts native binary buffers unchanged',()=>{const input=new Uint8Array([1,2,255]).buffer;expect(wifiChunkBytes(input)).toBe(input);});
it('converts JSON-array IPC fallback bytes without changing their contents',()=>{expect([...new Uint8Array(wifiChunkBytes([0,128,255]))]).toEqual([0,128,255]);});
it('respects typed-array offsets',()=>{expect([...new Uint8Array(wifiChunkBytes(new Uint8Array([7,8,9,10]).subarray(1,3)))]).toEqual([8,9]);});
it('rejects empty, oversized and non-byte chunks',()=>{for(const value of [[],new ArrayBuffer(0),[-1],[256],[1.5],{},new ArrayBuffer(262145)])expect(()=>wifiChunkBytes(value)).toThrow();});
