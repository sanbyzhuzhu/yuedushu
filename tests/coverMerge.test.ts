import { expect, it } from 'vitest';
import { mergeManifest, newerMeta } from '../src/sync/merge';
import type { BookMeta } from '../src/engine/types';
const base: BookMeta = {id:'book',title:'测试书',author:'',format:'epub',size:100,addedAt:1,nodeId:null,updatedAt:10};
it('preserves a locally stored cover when a newer manifest omits its bytes', () => {
  const merged = newerMeta({...base,hasCover:true}, {...base,updatedAt:20});
  expect(merged.hasCover).toBe(true);
  expect(merged.cover).toBeUndefined();
});
it('a metadata-only remote edit cannot revert a newer custom cover', () => {
  const merged = newerMeta({...base,cover:'new',hasCover:true,coverUpdatedAt:30,updatedAt:30}, {...base,title:'renamed',cover:'old',coverUpdatedAt:5,updatedAt:40});
  expect(merged.title).toBe('renamed'); expect(merged.cover).toBe('new'); expect(merged.coverUpdatedAt).toBe(30);
});
it('explicit removal wins over an older remote cover', () => {
  const merged = newerMeta({...base,hasCover:false,coverUpdatedAt:30,updatedAt:30}, {...base,cover:'old',coverUpdatedAt:5,updatedAt:40});
  expect(merged.hasCover).toBe(false); expect(merged.cover).toBeUndefined();
});
it('does not stamp previous bytes with the new revision announced in a manifest', () => {
  const merged = newerMeta({...base,cover:'old',hasCover:true,coverUpdatedAt:5}, {...base,hasCover:true,coverUpdatedAt:30,updatedAt:30});
  expect(merged.cover).toBeUndefined(); expect(merged.hasCover).toBe(true); expect(merged.coverUpdatedAt).toBe(30);
});
it('full book bytes resolve the same cover revision announced in a manifest', () => {
  expect(newerMeta({...base,hasCover:true,coverUpdatedAt:30}, {...base,cover:'new',hasCover:true,coverUpdatedAt:30}).cover).toBe('new');
});
it('hidden state survives the metadata manifest merge', () => {
  const result = mergeManifest([], [base], {books:[],nodes:[]}, {version:1,updatedAt:30,device:'test',nodes:[],books:[{...base,updatedAt:30,hidden:true,rev:30}],deletedBookIds:[],deletedNodeIds:[]});
  expect(result.metas.get('book')?.hidden).toBe(true);
});
