/**
 * The facade's React version policy (issue 49; amends D1/D5 for the facade only).
 *
 * `@pixi/react` declares `"react": "^19.3.0"`, so installs never fail with ERESOLVE on a newer React, while the
 * React 19.3 adapter it builds in is certified for React 19.3 only. A React 19 minor other than 19.3 therefore
 * composes, and logs ONE console warning that names the certified version and how to pin. A React outside the 19
 * major cannot work with the reconciler the facade depends on: the adapter's own `CompatibilityError`
 * (`UNSUPPORTED_TUPLE`) still rejects it. The modular per-minor adapter packages keep their exact peers and always
 * reject another minor.
 */

/** The React minor the facade's adapter is certified for, and the exact versions certified. */
export const CERTIFIED_REACT = Object.freeze({ minor: '19.3', tested: Object.freeze(['19.3.0']) });

function minorOf(version: string): string | undefined
{
    return (/^(\d+\.\d+)\./).exec(version)?.[1];
}

/** The warning for an uncertified React 19 minor. */
export function uncertifiedReactWarning(version: string): string
{
    const minor = minorOf(version) ?? version;

    return `@pixi/react is certified for React ${CERTIFIED_REACT.minor} (tested: ${CERTIFIED_REACT.tested.join(', ')}), `
        + `but React ${version} is installed. It will run, but this React ${minor} combination is not certified. `
        + `To pin a certified combination, either pin react and react-dom to ${CERTIFIED_REACT.minor} `
        + `(for example "react": "~${CERTIFIED_REACT.tested[0]}"), or compose your own renderer with createRenderer and `
        + `the React adapter package for React ${minor} instead of the default @pixi/react composition.`;
}

/** How the facade treats an installed React version. */
export type ReactSupport = 'certified' | 'uncertified-minor' | 'unsupported';

/**
 * Returns the facade's check. It returns `certified` for React 19.3.x, `unsupported` for another React major (the
 * caller rejects it), and `uncertified-minor` for any other React 19 minor, warning the first time (per returned
 * check).
 */
export function createReactVersionCheck(warn: (message: string) => void = (message) => console.warn(message))
{
    let warned = false;

    return (version: string): ReactSupport =>
    {
        if (minorOf(version) === CERTIFIED_REACT.minor)
        {
            return 'certified';
        }

        if (!version.startsWith('19.'))
        {
            return 'unsupported';
        }

        if (!warned)
        {
            warned = true;
            warn(uncertifiedReactWarning(version));
        }

        return 'uncertified-minor';
    };
}

/** The check every facade composition of this package copy uses: one warning per loaded copy. */
export const checkFacadeReact = createReactVersionCheck();
