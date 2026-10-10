import { VERSION } from 'pixi.js';
import { createReact18Binding } from '../../../../react-shared/fixtures/react-18/binding';
import { describeConformance } from '@pixi-react-provisional/conformance';

describeConformance(createReact18Binding(VERSION), { timeout: 15_000 });
