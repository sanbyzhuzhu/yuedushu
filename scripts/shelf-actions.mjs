export async function shelfAction(page, name, menu = '更多') {
  await page.getByRole('button', { name: menu, exact: true }).click();
  await page.getByRole('dialog', { name: menu === '管理' ? '书架管理' : '更多', exact: true }).getByRole('button', { name: new RegExp('^' + name) }).click();
}
export async function shelfView(page, name) {
  await page.getByRole('button', { name: '排列', exact: true }).click();
  await page.getByRole('dialog', { name: '排列书架' }).getByRole('button', { name, exact: true }).click();
  await page.getByRole('button', { name: '完成', exact: true }).click();
}
export async function shelfSort(page, value) {
  await page.getByRole('button', { name: '排列', exact: true }).click();
  await page.getByLabel('排序方式').selectOption(value);
  await page.getByRole('button', { name: '完成', exact: true }).click();
}
export async function shelfVersion(page, version) {
  await shelfAction(page, '关于阅读树');
  await page.getByLabel('版本 ' + version).waitFor();
  await page.getByText('v' + version + ' · 清简书架版', { exact: true }).waitFor();
  await page.getByRole('button', { name: '关闭', exact: true }).click();
}
