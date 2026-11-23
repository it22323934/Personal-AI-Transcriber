import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader/opsz.css';
import '../ui/styles.css';
import './library.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initTheme } from '../ui/theme';
import { Library } from './Library';

initTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Library />
  </StrictMode>,
);
