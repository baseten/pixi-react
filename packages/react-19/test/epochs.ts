import * as hostConfig190 from '../src/19.0/hostConfig';
import * as entry190 from '../src/19.0/index';
import * as hostConfig191 from '../src/19.1/hostConfig';
import * as entry191 from '../src/19.1/index';
import * as hostConfig192 from '../src/19.2/hostConfig';
import * as entry192 from '../src/19.2/index';
import * as hostConfig193 from '../src/19.3/hostConfig';
import * as entry193 from '../src/19.3/index';

/** Every epoch with its source modules and the npm alias of the reconciler it bundles. */
export const EPOCHS = [
    { epoch: '19.0', alias: 'react-reconciler-0.31', hostConfig: hostConfig190, entry: entry190 },
    { epoch: '19.1', alias: 'react-reconciler-0.32', hostConfig: hostConfig191, entry: entry191 },
    { epoch: '19.2', alias: 'react-reconciler-0.33', hostConfig: hostConfig192, entry: entry192 },
    { epoch: '19.3', alias: 'react-reconciler-0.34', hostConfig: hostConfig193, entry: entry193 },
] as const;
