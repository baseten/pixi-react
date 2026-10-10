/**
 * Setup for data-only probes only (vitest.config.mts loads it when cell.json has `dataOnly`). The conformance suite
 * calls `act` from 'react', which React exports from 18.3.0 on; before that it lives in 'react-dom/test-utils'. This
 * lends the older React that testing helper so the suite can run at all; the adapters are untouched.
 */
import React from 'react';
import * as testUtils from 'react-dom/test-utils';

const exports = React as unknown as Record<string, unknown>;

if (typeof exports.act !== 'function' && typeof (testUtils as Record<string, unknown>).act === 'function')
{
    exports.act = (testUtils as Record<string, unknown>).act;
    // eslint-disable-next-line no-console -- recorded in the data-only log.
    console.log(`COMPAT_DATA_SHIM react ${React.version}: act taken from react-dom/test-utils`);
}
