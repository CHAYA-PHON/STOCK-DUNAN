import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Intercept and suppress benign Vite HMR/network-level WebSocket rejections to prevent iframe error overlays
if (typeof window !== "undefined") {
  window.addEventListener("unhandledrejection", (event) => {
    const msg = event.reason?.message || String(event.reason || "");
    if (msg.includes("WebSocket") || msg.includes("websocket")) {
      event.preventDefault();
      console.warn("Suppressed benign WebSocket rejection:", msg);
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
