import { VERSION } from 'pixi.js';
import { createReact18Binding } from '../../shared/binding';
import { describeConformance } from '@pixi-react-provisional/conformance';

describeConformance(createReact18Binding(VERSION), { timeout: 15_000 });
