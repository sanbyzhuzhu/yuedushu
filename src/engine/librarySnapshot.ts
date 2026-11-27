/** Apply a database read without undoing edits/imports committed while it ran. */
export function reconcileLibrarySnapshot<T extends {id:string}>(loaded:T[], before:T[], current:T[]):T[] {
  if (before === current) return loaded;
  const previous = new Map(before.map(item => [item.id,item]));
  const present = new Set(current.map(item => item.id));
  const result = new Map(loaded.filter(item => !previous.has(item.id) || present.has(item.id)).map(item => [item.id,item]));
  for (const item of current) if (previous.get(item.id) !== item) result.set(item.id,item);
  return [...result.values()];
}
