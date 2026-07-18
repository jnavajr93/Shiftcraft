import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.jsx';

// eslint-disable-next-line no-undef
console.log(`Shiftcraft build ${__GIT_SHA__}`);

// Apply saved or system theme before first paint to avoid flash.
const saved = localStorage.getItem('shiftcraft.theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
document.documentElement.setAttribute('data-theme', saved || (prefersDark ? 'dark' : 'light'));

createRoot(document.getElementById('root')).render(
  <StrictMode><App /></StrictMode>
);
