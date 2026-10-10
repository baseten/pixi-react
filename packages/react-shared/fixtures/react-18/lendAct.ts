/**
 * Setup file of the React 18.0, 18.1 and 18.2 fixtures (config.mjs adds it for React before 18.3). The conformance
 * harness calls `act` from 'react', which React exports from 18.3.0 on; before that it lives in
 * 'react-dom/test-utils'. This lends that React its own testing helper, unchanged, so the suite runs as written; the
 * adapter under test is untouched and nothing it does is bypassed.
 */
import React from 'react';
import * as testUtils from 'react-dom/test-utils';

const exports = React as unknown as Record<string, unknown>;
const lent = (testUtils as Record<string, unknown>).act;

if (typeof exports.act !== 'function')
{
    if (typeof lent !== 'function')
    {
        throw new Error(`React ${React.version}: neither React.act nor react-dom/test-utils' act exists`);
    }

    exports.act = lent;
}
