import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Shell } from './Shell';
import './styles.css';

const params = new URLSearchParams(window.location.search);
const mode = params.has('test') ? 'test' : 'interactive';
// Test mode renders with WebGL unless `backend=webgpu` asks for the (non-deterministic) WebGPU smoke backend.
const backend = params.get('backend') === 'webgpu' ? 'webgpu' : 'webgl';

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <Shell path={window.location.pathname} mode={mode} backend={backend} />
    </StrictMode>,
);
