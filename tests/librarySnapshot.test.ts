import {expect,it} from 'vitest';
import {reconcileLibrarySnapshot} from '../src/engine/librarySnapshot';
const old={id:'old',title:'旧书'};
it('uses an unchanged database snapshot when nothing changed during the read',()=>{
  const before=[old],loaded=[{...old,title:'数据库更新'}];
  expect(reconcileLibrarySnapshot(loaded,before,before)).toEqual(loaded);
});
it('preserves a newly imported book while applying the completed read',()=>{
  const added={id:'new',title:'新书'};
  expect(reconcileLibrarySnapshot([old],[old],[added,old])).toEqual([old,added]);
});
it('does not resurrect a book deleted while loading',()=>{
  expect(reconcileLibrarySnapshot([old],[old],[])).toEqual([]);
});
it('keeps in-flight cover and hidden edits over the old read',()=>{
  const edited={...old,hidden:true,coverUpdatedAt:123};
  expect(reconcileLibrarySnapshot([old],[old],[edited])).toEqual([edited]);
});
it('deduplicates a committed import already present in the database read',()=>{
  const added={id:'new',title:'新书'};
  expect(reconcileLibrarySnapshot([old,added],[old],[added,old])).toHaveLength(2);
});
it('keeps concurrent category additions while loading saved categories',()=>{
  const node={id:'node',name:'新分类'};
  expect(reconcileLibrarySnapshot([],[],[node])).toEqual([node]);
});
