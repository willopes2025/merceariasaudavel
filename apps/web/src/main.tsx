import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// App do cliente: manifesto próprio (instalável no celular, abre em /app).
if (window.location.pathname === '/app' || window.location.pathname.startsWith('/app/')) {
  const manifest = document.createElement('link');
  manifest.rel = 'manifest';
  manifest.href = '/app.webmanifest';
  document.head.appendChild(manifest);
  const apple = document.createElement('link');
  apple.rel = 'apple-touch-icon';
  apple.href = '/icons/apple-touch-icon.png';
  document.head.appendChild(apple);
  const capable = document.createElement('meta');
  capable.name = 'apple-mobile-web-app-capable';
  capable.content = 'yes';
  document.head.appendChild(capable);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
