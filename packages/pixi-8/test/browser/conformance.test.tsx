import { VERSION } from 'pixi.js';
import { createPixi8Binding } from './binding';
import { describeConformance } from '@pixi-react-provisional/conformance';

describeConformance(createPixi8Binding(VERSION), { timeout: 15_000 });
