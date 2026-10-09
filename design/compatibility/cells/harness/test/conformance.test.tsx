import { VERSION } from 'pixi.js';
import { createCellBinding } from './binding';
import cell from '../cell.json';
import { describeConformance } from '@pixi-react-provisional/conformance';

// The whole conformance catalogue, in Chromium, against this cell's exact React and Pixi.
describeConformance(createCellBinding(`${cell.id} (pixi.js ${VERSION})`, cell.conformanceCapabilities, cell.expectedConformanceFailures), { timeout: 15_000 });
