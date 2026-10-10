/**
 * Setup for cells (and data-only probes) with React before 18.3 (vitest.config.mts loads it when cell.json has
 * `lendAct`). The conformance suite calls `act` from 'react', which React exports from 18.3.0 on; before that it lives
 * in 'react-dom/test-utils'. This lends that React its own testing helper, unchanged, so the suite runs as written; the
 * adapters are untouched and nothing they check is bypassed. It fails the run if neither act exists.
 */
import React from 'react';
import * as testUtils from 'react-dom/test-utils';

const exports = React as unknown as Record<string, unknown>;
const lent = (testUtils as Record<string, unknown>).act;

if (typeof exports.act !== 'function')
{
    if (typeof lent !== 'function') throw new Error(`React ${React.version}: neither React.act nor react-dom/test-utils' act exists`);
    exports.act = lent;
    // eslint-disable-next-line no-console -- recorded in the conformance log.
    console.log(`COMPAT_LEND_ACT react ${React.version}: act taken from react-dom/test-utils`);
}
