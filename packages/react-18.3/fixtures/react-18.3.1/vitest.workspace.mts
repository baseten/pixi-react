import { defineWorkspace } from 'vitest/config';
import { fixtureWorkspace } from '../../../react-shared/fixtures/react-18/config.mjs';

// React 18.3.1: the tested tuple this fixture pins. See packages/react-shared/fixtures/react-18/config.mjs.
export default defineWorkspace(fixtureWorkspace(import.meta.dirname));
