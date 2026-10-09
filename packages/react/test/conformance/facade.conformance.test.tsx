import { facadeBinding } from './facadeBinding';
import { describeConformance } from '@pixi-react-provisional/conformance';

describeConformance(facadeBinding, { timeout: 15_000 });
