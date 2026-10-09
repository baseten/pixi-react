import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import './styles.css';

const mode = new URLSearchParams(window.location.search).has('test') ? 'test' : 'interactive';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Shell path={window.location.pathname} mode={mode} />
    </StrictMode>,
);
