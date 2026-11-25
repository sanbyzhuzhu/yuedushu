import { useEffect, useRef, useState } from 'react';
import { popBack, registerBackHandler } from './platform/backHandler';
import { useLibrary } from './store/library';
import { useSettings } from './store/settings';
import { useSync } from './sync/sync';
import { Bookshelf } from './ui/Bookshelf';
import { Reader } from './ui/Reader';
import { ExternalImports } from './ui/ExternalImports';
import { useAppUpdate } from './store/appUpdate';

export default function App() {
  const initLibrary = useLibrary((st) => st.init);
  const initSettings = useSettings((st) => st.init);
  const [screen, setScreen] = useState<{ name: 'shelf' } | { name: 'reader'; id: string }>({ name: 'shelf' });
  const [exitHint, setExitHint] = useState(false);
  const screenRef = useRef(screen);
  screenRef.current = screen;

  useEffect(() => {
    const check = () => { if (document.visibilityState === 'visible') void useAppUpdate.getState().check(); };
    const delayed = setTimeout(check, 10000);
    const interval = setInterval(check, 60 * 60 * 1000);
    document.addEventListener('visibilitychange', check);
    return () => { clearTimeout(delayed); clearInterval(interval); document.removeEventListener('visibilitychange', check); };
  }, []);

  useEffect(() => {
    void initLibrary();
    void initSettings();
    void useSync.getState().init().then(() => useSync.getState().startLoop());
  }, [initLibrary, initSettings]);

  /** Android 返回键 / 浏览器后退：面板→菜单→阅读页回书架→书架二次确认退出 */
  useEffect(() => {
    if (!history.state?.rt) history.pushState({ rt: 1 }, '');
    let hintAt = 0;
    let hintTimer: ReturnType<typeof setTimeout> | undefined;
    const handleBack = () => {
      if (popBack()) {
        hintAt = 0;
        setExitHint(false);
        return 'handled';
      }
      if (screenRef.current.name === 'reader') { setScreen({ name: 'shelf' }); hintAt = 0; return 'handled'; }
      const now = Date.now();
      if (now - hintAt < 2200) {
        hintAt = 0;
        setExitHint(false);
        return 'exit';
      }
      hintAt = now;
      setExitHint(true);
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => setExitHint(false), 2000);
      return 'handled';
    };
    const nativeWindow = window as unknown as { readingTreeBack?: () => string };
    nativeWindow.readingTreeBack = handleBack;
    const onPop = () => { if (handleBack() !== 'exit') history.pushState({ rt: 1 }, ''); };
    window.addEventListener('popstate', onPop);
    const unreg = registerBackHandler(() => false); // 兜底（App 级无状态可关）
    return () => {
      window.removeEventListener('popstate', onPop);
      delete nativeWindow.readingTreeBack;
      unreg();
      if (hintTimer) clearTimeout(hintTimer);
    };
  }, []);

  return (
    <>
      {screen.name === 'reader'
        ? <Reader key={screen.id} bookId={screen.id} onBack={() => setScreen({ name: 'shelf' })} onOpen={(id) => setScreen({ name: 'reader', id })} />
        : <Bookshelf onOpen={(id) => setScreen({ name: 'reader', id })} />}
      <ExternalImports onOpen={(id) => setScreen({ name: 'reader', id })} />
      {exitHint ? <div className="exit-hint">再按一次返回键退出</div> : null}
    </>
  );
}
