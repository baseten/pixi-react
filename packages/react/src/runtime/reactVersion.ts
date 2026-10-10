/**
 * The facade's React version policy (issue 49; amends D1/D5 for the facade only).
 *
 * `@pixi/react` declares `"react": "^19.3.0"`, so installs never fail with ERESOLVE on a newer React, while the
 * React 19.3 adapter it builds in is tested with React 19.3 only (the #13 compatibility cells; issue 17's dated
 * verification records list the exact tuples verified, as evidence, not a support guarantee). A React 19 minor other
 * than 19.3 therefore composes, and logs ONE console warning that names the tested version and how to pin. A React
 * outside the 19 major cannot work with the reconciler the facade depends on: the adapter's own `CompatibilityError`
 * (`UNSUPPORTED_TUPLE`) still rejects it. The modular per-minor adapter packages keep their exact peers and always
 * reject another minor.
 */

/**
 * The React minor the facade's adapter is tested with, and the exact versions tested. scripts/release/policy.mjs
 * checks these against the compatibility manifest (design/compatibility/seed.json).
 */
export const TESTED_REACT = Object.freeze({ minor: '19.3', versions: Object.freeze(['19.3.0']) });

function minorOf(version: string): string | undefined
{
    return (/^(\d+\.\d+)\./).exec(version)?.[1];
}

/** The warning for an untested React 19 minor. */
export function untestedReactWarning(version: string): string
{
    const minor = minorOf(version) ?? version;

    return `@pixi/react is tested with React ${TESTED_REACT.minor} (${TESTED_REACT.versions.join(', ')}), `
        + `but React ${version} is installed. It will run, but this React ${minor} combination is not tested. `
        + `To use a tested combination, either pin react and react-dom to ${TESTED_REACT.minor} `
        + `(for example "react": "~${TESTED_REACT.versions[0]}"), or compose your own renderer with createRenderer and `
        + `the React adapter package for React ${minor} instead of the default @pixi/react composition.`;
}

/** How the facade treats an installed React version. */
export type ReactSupport = 'tested' | 'untested-minor' | 'unsupported';

/**
 * Returns the facade's check. It returns `tested` for React 19.3.x, `unsupported` for another React major (the caller
 * rejects it), and `untested-minor` for any other React 19 minor, warning the first time (per returned check).
 */
export function createReactVersionCheck(warn: (message: string) => void = (message) => console.warn(message))
{
    let warned = false;

    return (version: string): ReactSupport =>
    {
        if (minorOf(version) === TESTED_REACT.minor)
        {
            return 'tested';
        }

        if (!version.startsWith('19.'))
        {
            return 'unsupported';
        }

        if (!warned)
        {
            warned = true;
            warn(untestedReactWarning(version));
        }

        return 'untested-minor';
    };
}

/** The check every facade composition of this package copy uses: one warning per loaded copy. */
export const checkFacadeReact = createReactVersionCheck();
