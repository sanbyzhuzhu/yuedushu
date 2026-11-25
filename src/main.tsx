import './platform/compatibility';
import { requestPersistentStorage } from './platform/storageHealth';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/global.css';
import './styles/refinement.css';
import './styles/shelf.css';
void requestPersistentStorage();
// Expiry cleanup is deferred so it does not compete with opening the bookshelf.
window.setTimeout(() => {
  void import('./engine/recycleBin').then(m => m.listDeletedBooks()).catch(() => { /* Retry when opening the recycle bin. */ });
}, 15000);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
