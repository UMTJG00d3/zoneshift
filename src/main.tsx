import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './tailwind.css'
import './index.css'
import App from './App'

// Support ?theme=dark|light URL param for HUD embedding
const params = new URLSearchParams(window.location.search);
const theme = params.get('theme');
if (theme) {
  document.documentElement.setAttribute('data-theme', theme);
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
