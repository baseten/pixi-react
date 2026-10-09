import { explicitBinding } from './explicitBinding';
import { describeConformance } from '@pixi-react-provisional/conformance';

describeConformance(explicitBinding, { timeout: 15_000 });
