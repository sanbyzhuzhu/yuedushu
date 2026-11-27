import fs from 'node:fs';
import assert from 'node:assert/strict';
import {createHash,createPublicKey,verify} from 'node:crypto';
const version=JSON.parse(fs.readFileSync('package.json','utf8')).version;
const dir=`releases/${version}`;
const manifest=JSON.parse(fs.readFileSync(`${dir}/update.json`,'utf8'));
const config=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8'));
const pubPacket=Buffer.from(Buffer.from(config.plugins.updater.pubkey,'base64').toString().trim().split(/\r?\n/)[1],'base64');
const publicKey=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),pubPacket.subarray(10)]),format:'der',type:'spki'});
const entry=manifest.platforms['windows-x86_64'];
const lines=Buffer.from(entry.signature,'base64').toString().trim().split(/\r?\n/);
const packet=Buffer.from(lines[1],'base64');
const trusted=lines[2].replace(/^trusted comment: /,'');
const globalSignature=Buffer.from(lines[3],'base64');
const bytes=fs.readFileSync(`${dir}/阅读树_${version}_Windows_x64_安装版.exe`);
function valid(data,comment=trusted) {
  const message=packet.subarray(0,2).toString()==='ED'?createHash('blake2b512').update(data).digest():data;
  return packet.subarray(2,10).equals(pubPacket.subarray(2,10)) && verify(null,message,publicKey,packet.subarray(10))
    && verify(null,Buffer.concat([packet.subarray(10),Buffer.from(comment)]),publicKey,globalSignature);
}
assert.ok(valid(bytes),'Installer signature must match embedded public key');
assert.ok(trusted.split('\t').includes(`version:${version}`),'Signature must bind release version');
const tampered=Buffer.from(bytes);tampered[tampered.length-1]^=1;
assert.equal(valid(tampered),false,'Modified installer must fail verification');
assert.equal(valid(bytes,trusted.replace(`version:${version}`,'version:99.99.99')),false,'Modified signed version must fail verification');
assert.equal(config.plugins.updater.requireSignedVersion,true);
assert.equal(config.plugins.updater.windows.installMode,'quiet');
for(const [target,name] of [['windows',`阅读树_${version}_Windows_x64_安装版.exe`],['android',`阅读树_${version}_Android_release.apk`]]) assert.equal(manifest.sha256[target],createHash('sha256').update(fs.readFileSync(`${dir}/${name}`)).digest('hex'));
console.log('PASS signed Windows installer, signed release version, tampered bytes/version rejected, quiet install mode, Windows/Android SHA-256 manifest');
