import { defineConfig } from 'vitest/config';
import { fixtureConfig } from '../shared/config.mjs';

// React 19.0.8: the audit tuple this fixture pins. See ../shared/config.mjs.
export default defineConfig(fixtureConfig(import.meta.dirname));
