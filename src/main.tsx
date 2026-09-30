import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { debugApi } from './debug';
import { useStore } from './store/store';
import './styles.css';

// Test/debug handle (used by the Playwright suite).
(window as unknown as { __reel: unknown }).__reel = { store: useStore, ...debugApi };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
