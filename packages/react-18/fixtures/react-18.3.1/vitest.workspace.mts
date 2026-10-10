import { defineWorkspace } from 'vitest/config';
import { fixtureWorkspace } from '../shared/config.mjs';

// React 18.3.1: the tested tuple this fixture pins. See ../shared/config.mjs.
export default defineWorkspace(fixtureWorkspace(import.meta.dirname));
