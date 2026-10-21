import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { PasswordRecoveryPage } from './pages/PasswordRecoveryPage';
import './styles/index.css';
import { registerServiceWorker } from './lib/pwa';

registerServiceWorker();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {window.location.pathname === '/reset-password' ? <PasswordRecoveryPage /> : <App />}
  </React.StrictMode>,
);

