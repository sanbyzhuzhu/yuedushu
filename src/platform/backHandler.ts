/**
 * 系统返回键拦截（Android）+ 桌面浏览器后退键：
 * Android 原生回调调用 window.readingTreeBack；浏览器后退走 popstate。
 * 两者共用处理器栈：关面板 → 阅读页回书架。书架裸态连续返回两次
 * 才向原生返回 exit，由 Activity 退出，避免依赖 WebView 历史记录。
 */
export type BackHandler = () => boolean;

const stack: BackHandler[] = [];

/** 注册处理器（组件挂载时调用，返回卸载函数）。后注册者优先（栈顶）。 */
export function registerBackHandler(h: BackHandler): () => void {
  stack.push(h);
  return () => {
    const i = stack.indexOf(h);
    if (i >= 0) stack.splice(i, 1);
  };
}

/** 依次询问处理器；有任一处理（返回 true）则 true */
export function popBack(): boolean {
  for (let i = stack.length - 1; i >= 0; i--) {
    try {
      if (stack[i]()) return true;
    } catch {
      /* 单个处理器异常不阻断其余 */
    }
  }
  return false;
}
