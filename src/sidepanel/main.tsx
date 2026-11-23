import '@fontsource-variable/inter';
import '@fontsource-variable/newsreader/opsz.css';
import '../ui/styles.css';
import './sidepanel.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SidePanel } from './SidePanel';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SidePanel />
  </StrictMode>,
);
