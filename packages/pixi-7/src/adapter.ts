/**
 * `Pixi7Adapter`: the Pixi 7 `PixiAdapter`. The class is created per loaded Pixi module by `bindPixi` (see `bind.ts`);
 * the package entry points export the class bound to the Pixi module their own module system loads.
 */
import { ADAPTER_ID, CAPABILITIES, PIXI8_ONLY_CAPABILITIES } from './nodes.js';
import { Pixi7Session, type SessionGlobals } from './session.js';
import { checkSupportedVersion, PIXI7_BOUNDS, PIXI7_PEER_RANGE, PIXI7_TESTED_VERSIONS } from './version.js';
import { type AdapterManifest, type CapabilityMap, CompatibilityError, type Constructor, type NodeDefinition, PixiAdapter, type PixiSession, type RootTarget, type Runtime } from '@pixi-react-provisional/core';

import type { Pixi7Types } from './types.js';

/** Read as written, so a consumer's bundler drops development-only message text from production builds (issue 58). */
declare const process: { readonly env: { readonly NODE_ENV?: string } };

/**
 * This package's version, recorded in the manifest. Kept in step with package.json by a unit test. It is the lockstep
 * release version (the facade's), not a Pixi version: this package targets Pixi 7.
 */
export const PACKAGE_VERSION = '0.0.0';

/** Pixi names whose unprefixed element form is not `lowerFirst(Name)` (upstream `NameOverrides`, plus `FXAAFilter`). */
const NAME_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
    htmlText: 'HTMLText',
    fxaaFilter: 'FXAAFilter',
});

/**
 * Normalizes an element or catalog name once: `pixiSprite` and `sprite` become `Sprite`; `pixiHtmlText`,
 * `htmlText` and `HTMLText` become `HTMLText`. Names that are not identifiers (such as the registry's
 * `component:1` ids) are left unchanged.
 */
export function normalizePixiName(name: string): string
{
    if (!(/^[A-Za-z_$][\w$]*$/).test(name))
    {
        return name;
    }

    const prefixed = (/^pixi([A-Z].*)$/).exec(name);
    const unprefixed = prefixed ? `${prefixed[1][0].toLowerCase()}${prefixed[1].slice(1)}` : name;

    if (Object.prototype.hasOwnProperty.call(NAME_OVERRIDES, unprefixed))
    {
        return NAME_OVERRIDES[unprefixed];
    }

    return `${unprefixed[0].toUpperCase()}${unprefixed.slice(1)}`;
}

/** Tested bounds and the capability differences, recorded in the manifest next to the ABI fields. */
export interface Pixi7ManifestDetails
{
    /** The installed `pixi.js` VERSION this adapter is bound to. */
    readonly installed: string;
    readonly peerRange: string;
    readonly bounds: typeof PIXI7_BOUNDS;
    readonly testedVersions: readonly string[];
    /** Pixi 8 capabilities this adapter never provides, with the reason. */
    readonly unsupported: typeof PIXI8_ONLY_CAPABILITIES;
}

export interface Pixi7Manifest extends AdapterManifest
{
    readonly pixi: Pixi7ManifestDetails;
}

export interface Pixi7AdapterOptions
{
    /**
     * Capability IDs to withhold (`pixi7.filter`, `pixi7.particle-container`), so an application can verify a narrower
     * feature set. Elements that need a withheld capability throw `UNSUPPORTED_NODE` at registration.
     */
    readonly disable?: readonly string[];
}

/** What `bindPixi` hands each bound adapter class. */
export interface AdapterBinding
{
    readonly globals: Omit<SessionGlobals, 'nodes'> & { readonly createNodes: (enabled: (capability: string) => boolean) => SessionGlobals['nodes'] };
}

/**
 * The Pixi 7 adapter. It owns every Pixi operation: node definitions, construction, props, tree operations,
 * visibility, destruction, the application lifecycle, the ticker and Pixi's global settings. Construct it through
 * the package's exported `Pixi7Adapter`, which is this class bound to the loaded pixi.js module.
 */
export class Pixi7AdapterBase extends PixiAdapter<Pixi7Types>
{
    readonly manifest: Pixi7Manifest;
    /** The pixi.js exports this adapter is bound to (`PIXI7_BINDING_EXPORTS` of one loaded module). */
    readonly pixi: SessionGlobals['pixi'];
    private readonly sessionGlobals: SessionGlobals;

    constructor(binding: AdapterBinding, options: Pixi7AdapterOptions = {})
    {
        super();

        const { globals } = binding;
        const { pixi } = globals;

        this.pixi = pixi;

        const disabled = new Set(options.disable ?? []);
        const nodes = globals.createNodes((capability) => this.manifest.provides[capability] === 1);
        const provides: Record<string, number> = {
            [CAPABILITIES.mutation]: 1,
            [CAPABILITIES.visibility]: 1,
            [CAPABILITIES.application]: 1,
            [CAPABILITIES.ticker]: 1,
            [CAPABILITIES.globals]: 1,
        };

        for (const capability of [CAPABILITIES.filter, CAPABILITIES.particleContainer])
        {
            if (!disabled.has(capability))
            {
                provides[capability] = 1;
            }
        }

        this.manifest = Object.freeze({
            abi: Object.freeze({ major: 1 as const, minor: 0 }),
            id: ADAPTER_ID,
            packageVersion: PACKAGE_VERSION,
            verification: `pixi-7@${PACKAGE_VERSION}: browser conformance and Pixi cells on pixi.js `
                + `${PIXI7_TESTED_VERSIONS.join(', ')} (packages/pixi-7/test) and the compatibility cells; verified tuples: design/compatibility/verification`,
            provides: Object.freeze(provides) as CapabilityMap,
            requires: Object.freeze({}),
            pixi: Object.freeze({
                installed: String(pixi.VERSION),
                peerRange: PIXI7_PEER_RANGE,
                bounds: PIXI7_BOUNDS,
                testedVersions: PIXI7_TESTED_VERSIONS,
                unsupported: PIXI8_ONLY_CAPABILITIES,
            }),
        });
        this.sessionGlobals = { ...globals, nodes };
    }

    normalizeName(name: string): string
    {
        return normalizePixiName(name);
    }

    /** Rejects an installed pixi.js outside the peer range (Pixi 8 included) before allocation. */
    checkEnvironment(): void
    {
        const { pixi } = this;
        const verdict = checkSupportedVersion(pixi.VERSION);

        if (!verdict.supported)
        {
            throw new CompatibilityError(process.env.NODE_ENV !== 'production' ? `The Pixi 7 adapter does not support this installation: ${verdict.reason}.` : '', {
                code: 'UNSUPPORTED_TUPLE',
                adapterIds: [ADAPTER_ID],
                expected: { 'pixi.js': PIXI7_PEER_RANGE },
                actual: { 'pixi.js': String(pixi.VERSION) },
            });
        }
    }

    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
    {
        return this.sessionGlobals.nodes.describe(ctor, name);
    }

    createSession(_runtime: Runtime<Pixi7Types>, target: RootTarget): PixiSession<Pixi7Types>
    {
        // Check against the canvas constructor of the target's own window, so a canvas in an iframe or another
        // window (which is not an instance of this realm's HTMLCanvasElement) is accepted.
        const view = (target as { ownerDocument?: { defaultView?: { HTMLCanvasElement?: typeof HTMLCanvasElement } | null } })
            ?.ownerDocument?.defaultView;
        const CanvasElement = view?.HTMLCanvasElement ?? globalThis.HTMLCanvasElement;

        if (!CanvasElement || !(target instanceof CanvasElement))
        {
            throw new CompatibilityError(process.env.NODE_ENV !== 'production' ? 'The Pixi 7 adapter renders into the canvas core created for the root.' : '', {
                code: 'ABI_MISMATCH',
                adapterIds: [ADAPTER_ID],
            });
        }

        return new Pixi7Session(this.sessionGlobals, target);
    }

    /** Standalone `applyProps`: applies plain, dashed, point and event props to any instance. */
    applyProps(node: object, props: unknown): void
    {
        this.sessionGlobals.nodes.applyChanges(node, {}, props);
    }
}

/** The constructor type of the bound adapter class each entry point exports as `Pixi7Adapter`. */
export type Pixi7AdapterConstructor = new (options?: Pixi7AdapterOptions) => Pixi7AdapterBase;

/** Binds the adapter class to one Pixi module. */
export function createAdapterClass(binding: AdapterBinding): Pixi7AdapterConstructor
{
    return class Pixi7Adapter extends Pixi7AdapterBase
    {
        constructor(options: Pixi7AdapterOptions = {})
        {
            super(binding, options);
        }
    };
}
