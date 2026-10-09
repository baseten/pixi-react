/**
 * `Pixi8Adapter`: the Pixi 8 `PixiAdapter`. The class is created per loaded Pixi module by `bindPixi` (see
 * `bind.ts`); the package entry points export the class bound to the Pixi module their own module system loads.
 */
import { ADAPTER_ID, CAPABILITIES, type PixiFeatures } from './nodes.js';
import { Pixi8Session, type SessionGlobals } from './session.js';
import { checkSupportedVersion, PIXI8_BOUNDS, PIXI8_PEER_RANGE, PIXI8_TESTED_VERSIONS } from './version.js';
import { type AdapterManifest, type CapabilityMap, CompatibilityError, type Constructor, type NodeDefinition, PixiAdapter, type PixiSession, type RootTarget, type Runtime } from '@pixi-react-provisional/core';

import type { Pixi8Types } from './types.js';

/** This package's version, recorded in the manifest. Kept in step with package.json by a unit test. */
export const PACKAGE_VERSION = '0.0.0';

/** Pixi upstream names whose unprefixed element form is not `lowerFirst(Name)` (upstream `NameOverrides`). */
const NAME_OVERRIDES: Readonly<Record<string, string>> = Object.freeze({
    htmlText: 'HTMLText',
    htmlTextPipe: 'HTMLTextPipe',
    htmlTextRenderData: 'HTMLTextRenderData',
    htmlTextStyle: 'HTMLTextStyle',
    htmlTextSystem: 'HTMLTextSystem',
    iglUniformData: 'IGLUniformData',
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

/** Certified bounds and detected features, recorded in the manifest next to the ABI fields. */
export interface Pixi8ManifestDetails
{
    /** The installed `pixi.js` VERSION this adapter is bound to. */
    readonly installed: string;
    readonly peerRange: string;
    readonly bounds: typeof PIXI8_BOUNDS;
    readonly testedVersions: readonly string[];
    readonly features: PixiFeatures;
}

export interface Pixi8Manifest extends AdapterManifest
{
    readonly pixi: Pixi8ManifestDetails;
}

export interface Pixi8AdapterOptions
{
    /**
     * Capability IDs to withhold even when the installed Pixi supports them (for example `pixi8.particle`), so an
     * application can certify a narrower feature set. Elements that need a withheld capability throw
     * `UNSUPPORTED_NODE` at registration.
     */
    readonly disable?: readonly string[];
}

/** What `bindPixi` hands each bound adapter class. */
export interface AdapterBinding
{
    readonly globals: Omit<SessionGlobals, 'nodes'> & { readonly createNodes: (enabled: (capability: string) => boolean) => SessionGlobals['nodes'] };
}

/**
 * The Pixi 8 adapter. It owns every Pixi operation: node definitions, construction, props, tree operations,
 * visibility, destruction, the application lifecycle, the ticker and Pixi's global settings. Construct it through
 * the package's exported `Pixi8Adapter`, which is this class bound to the loaded pixi.js module.
 */
export class Pixi8AdapterBase extends PixiAdapter<Pixi8Types>
{
    readonly manifest: Pixi8Manifest;
    /** The pixi.js module this adapter is bound to. */
    readonly pixi: SessionGlobals['pixi'];
    private readonly sessionGlobals: SessionGlobals;

    constructor(binding: AdapterBinding, options: Pixi8AdapterOptions = {})
    {
        super();

        const { globals } = binding;
        const { pixi } = globals;

        this.pixi = pixi;

        const disabled = new Set(options.disable ?? []);
        const nodes = globals.createNodes((capability) => this.manifest.provides[capability] === 1);
        const { features } = nodes;
        const optional: Array<[string, boolean]> = [
            [CAPABILITIES.filter, true],
            [CAPABILITIES.particle, features.particles],
            [CAPABILITIES.renderLayer, features.renderLayer],
            [CAPABILITIES.domContainer, features.domContainer],
        ];
        const provides: Record<string, number> = {
            [CAPABILITIES.mutation]: 1,
            [CAPABILITIES.visibility]: 1,
            [CAPABILITIES.application]: 1,
            [CAPABILITIES.ticker]: 1,
            [CAPABILITIES.globals]: 1,
        };

        for (const [capability, available] of optional)
        {
            if (available && !disabled.has(capability))
            {
                provides[capability] = 1;
            }
        }

        this.manifest = Object.freeze({
            abi: Object.freeze({ major: 1 as const, minor: 0 }),
            id: ADAPTER_ID,
            packageVersion: PACKAGE_VERSION,
            certification: `pixi-8@${PACKAGE_VERSION}: browser conformance and Pixi cells on pixi.js `
                + `${PIXI8_TESTED_VERSIONS.join(', ')} (packages/pixi-8/test); no issue-13 matrix certificate yet`,
            provides: Object.freeze(provides) as CapabilityMap,
            requires: Object.freeze({}),
            pixi: Object.freeze({
                installed: String(pixi.VERSION),
                peerRange: PIXI8_PEER_RANGE,
                bounds: PIXI8_BOUNDS,
                testedVersions: PIXI8_TESTED_VERSIONS,
                features,
            }),
        });
        this.sessionGlobals = { ...globals, nodes };
    }

    normalizeName(name: string): string
    {
        return normalizePixiName(name);
    }

    /** Rejects an installed pixi.js outside the peer range (including the excluded 8.5.0) before allocation. */
    checkEnvironment(): void
    {
        const { pixi } = this;
        const verdict = checkSupportedVersion(pixi.VERSION);

        if (!verdict.supported)
        {
            throw new CompatibilityError(`The Pixi 8 adapter does not support this installation: ${verdict.reason}.`, {
                code: 'UNSUPPORTED_TUPLE',
                adapterIds: [ADAPTER_ID],
                expected: { 'pixi.js': PIXI8_PEER_RANGE },
                actual: { 'pixi.js': String(pixi.VERSION) },
            });
        }
    }

    describe<C extends Constructor>(ctor: C, name: string): NodeDefinition<C>
    {
        return this.sessionGlobals.nodes.describe(ctor, name);
    }

    createSession(_runtime: Runtime<Pixi8Types>, target: RootTarget): PixiSession<Pixi8Types>
    {
        // Check against the canvas constructor of the target's own window, so a canvas in an iframe or another
        // window (which is not an instance of this realm's HTMLCanvasElement) is accepted.
        const view = (target as { ownerDocument?: { defaultView?: { HTMLCanvasElement?: typeof HTMLCanvasElement } | null } })
            ?.ownerDocument?.defaultView;
        const CanvasElement = view?.HTMLCanvasElement ?? globalThis.HTMLCanvasElement;

        if (!CanvasElement || !(target instanceof CanvasElement))
        {
            throw new CompatibilityError('The Pixi 8 adapter renders into the canvas core created for the root.', {
                code: 'ABI_MISMATCH',
                adapterIds: [ADAPTER_ID],
            });
        }

        return new Pixi8Session(this.sessionGlobals, target);
    }

    /** Standalone `applyProps`: applies plain, dashed, point and event props to any instance. */
    applyProps(node: object, props: unknown): void
    {
        this.sessionGlobals.nodes.applyChanges(node, {}, props);
    }

    /**
     * Removes the particles in `[begin, end)` of a ParticleContainer with the same meaning on every supported
     * Pixi version (the meaning of `removeParticles`' second argument changed in 8.10).
     */
    removeParticles<P>(container: { particleChildren: P[] }, begin: number, end: number): P[]
    {
        return this.sessionGlobals.nodes.removeParticleRange(container as never, begin, end) as P[];
    }
}

/** The constructor type of the bound adapter class each entry point exports as `Pixi8Adapter`. */
export type Pixi8AdapterConstructor = new (options?: Pixi8AdapterOptions) => Pixi8AdapterBase;

/** Binds the adapter class to one Pixi module. */
export function createAdapterClass(binding: AdapterBinding): Pixi8AdapterConstructor
{
    return class Pixi8Adapter extends Pixi8AdapterBase
    {
        constructor(options: Pixi8AdapterOptions = {})
        {
            super(binding, options);
        }
    };
}
