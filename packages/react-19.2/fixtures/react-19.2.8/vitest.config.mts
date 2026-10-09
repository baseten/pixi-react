import { defineConfig } from 'vitest/config';
import { fixtureConfig } from '../../../react-shared/fixtures/react-19/config.mjs';

// React 19.2.8: the audit tuple this fixture pins. See packages/react-shared/fixtures/react-19/config.mjs.
export default defineConfig(fixtureConfig(import.meta.dirname));
