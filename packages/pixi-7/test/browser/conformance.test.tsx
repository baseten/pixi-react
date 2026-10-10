import { VERSION } from 'pixi.js';
import { createPixi7Binding } from './binding';
import { describeConformance } from '@pixi-react-provisional/conformance';

describeConformance(createPixi7Binding(VERSION), { timeout: 15_000 });
