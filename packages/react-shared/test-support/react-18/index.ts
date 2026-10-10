/**
 * The unit suite every React 18 minor package runs against its own sources and its own build: the host-key audit
 * against the installed reconciler, the root factory's argument shape, the one shared reconciler, payload-based
 * updates, event priorities, the environment check and manifest, and the built package (D6 single instance,
 * dependencies instead of bundled code).
 *
 * Each package calls `describeReact18Package` from `test/package.test.ts` with its own modules; nothing here imports
 * a per-minor package.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompatibilityError, type PixiTypes } from '@pixi-react-provisional/core';

import type { EpochInfo } from '../../src/react-18/adapter';
import type { HostContainer, RootCallbacks } from '../../src/react-18/host';

type RootFactory = (reconciler: never, container: HostContainer<PixiTypes>, callbacks: RootCallbacks, prefix: string) => unknown;

interface HostConfigModule
{
    readonly RECONCILER_VERSION: string;
    readonly UNREACHABLE_HOST_KEYS: Readonly<Record<string, string>>;
    readonly UPDATE_PAYLOAD: unknown;
    createHostConfig(): object;
    createContainer: RootFactory;
    sharedReconciler(): unknown;
    getCurrentEventPriority(): number;
    prepareUpdate(previous: Record<string, unknown>, next: Record<string, unknown>): unknown;
}

interface EntryModule
{
    readonly EPOCH: EpochInfo;
    readonly React18Adapter: new () => object;
    readonly React18AdapterBase: abstract new () => object;
    readonly UNSUPPORTED_CAPABILITIES: Readonly<Record<string, string>>;
}

export interface React18PackageUnderTest
{
    /** The package directory (where its package.json is). */
    readonly packageDir: string;
    readonly hostConfig: HostConfigModule;
    readonly entry: EntryModule;
}

/**
 * Host-config keys the installed bundle reads (`$$$hostConfig.<key>`). React 18's reconcilers ship a development build
 * and a minified production build; the production build reads a subset (no hydration warnings, no act warnings).
 */
function bundleKeys(require: NodeRequire): { development: string[]; production: string[] }
{
    const dir = dirname(require.resolve('react-reconciler/package.json'));
    const read = (file: string) => [
        ...new Set([...readFileSync(join(dir, 'cjs', file), 'utf8')
            .matchAll(/\$\$\$hostConfig\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1])),
    ].sort();

    return {
        development: read('react-reconciler.development.js'),
        production: read('react-reconciler.production.min.js'),
    };
}

/** The `createContainer` parameter names of the installed development bundle. */
function installedParameters(require: NodeRequire): string[]
{
    const file = join(dirname(require.resolve('react-reconciler/package.json')), 'cjs', 'react-reconciler.development.js');
    const match = (/function createContainer\(([^)]*)\)/).exec(readFileSync(file, 'utf8'));

    return match![1].split(',').map((name) => name.trim()).filter(Boolean);
}

function withReact<T extends new() => object>(Adapter: T, version: string): InstanceType<T> & { checkEnvironment(): void }
{
    const instance = new Adapter() as InstanceType<T> & { reactVersion(): string; checkEnvironment(): void };

    instance.reactVersion = () => version;

    return instance;
}

export function describeReact18Package(pkg: React18PackageUnderTest): void
{
    const require = createRequire(join(pkg.packageDir, 'package.json'));
    const manifest = JSON.parse(readFileSync(join(pkg.packageDir, 'package.json'), 'utf8'));
    const { hostConfig, entry } = pkg;
    const { epoch } = entry.EPOCH;

    describe(`host-config keys match the installed react-reconciler ${hostConfig.RECONCILER_VERSION} exactly`, () =>
    {
        const keys = bundleKeys(require);
        const implemented = Object.keys(hostConfig.createHostConfig()).sort();
        const unreachable = Object.keys(hostConfig.UNREACHABLE_HOST_KEYS).sort();

        it('depends on the pinned reconciler version, exactly', () =>
        {
            expect(manifest.dependencies['react-reconciler']).toBe(hostConfig.RECONCILER_VERSION);
            expect(require('react-reconciler/package.json').version).toBe(hostConfig.RECONCILER_VERSION);
            expect(entry.EPOCH.reconciler).toBe(hostConfig.RECONCILER_VERSION);
        });

        it('reads in production only keys the development build also reads', () =>
        {
            expect(keys.production.length).toBeGreaterThan(0);
            expect(keys.production.filter((key) => !keys.development.includes(key))).toEqual([]);
        });

        it('implements only keys the bundle reads (no hooks copied from a React 19 epoch)', () =>
        {
            expect(implemented.filter((key) => !keys.development.includes(key))).toEqual([]);
        });

        it('implements or explains every key the bundle reads, and never both', () =>
        {
            expect(keys.development.filter((key) => !implemented.includes(key) && !unreachable.includes(key))).toEqual([]);
            expect(unreachable.filter((key) => !keys.development.includes(key))).toEqual([]);
            expect(implemented.filter((key) => unreachable.includes(key))).toEqual([]);
        });

        it('uses the React 18 shapes, not the React 19 ones', () =>
        {
            expect(implemented).toEqual(expect.arrayContaining(['getCurrentEventPriority', 'prepareUpdate', 'commitUpdate']));

            for (const react19Key of [
                'resolveUpdatePriority',
                'setCurrentUpdatePriority',
                'getCurrentUpdatePriority',
                'maySuspendCommit',
                'HostTransitionContext',
                'NotPendingTransition',
                'rendererPackageName',
            ])
            {
                expect(implemented, react19Key).not.toContain(react19Key);
                expect(keys.development, react19Key).not.toContain(react19Key);
            }
        });
    });

    describe('one shared reconciler per package copy', () =>
    {
        it('builds one reconciler for every runtime of the package copy', () =>
        {
            expect(hostConfig.sharedReconciler()).toBe(hostConfig.sharedReconciler());
        });

        it('builds a host config that depends on no runtime', () =>
        {
            expect(hostConfig.createHostConfig.length).toBe(0);
        });

        it('rejects a node no runtime created', () =>
        {
            const config = hostConfig.createHostConfig() as { appendChild(parent: object, child: object): void };

            expect(() => config.appendChild({}, {})).toThrow(/not owned/);
        });

        it('forgets a deleted node, so a retained instance does not keep its runtime alive', () =>
        {
            const config = hostConfig.createHostConfig() as {
                createInstance(type: string, props: object, container: HostContainer<PixiTypes>): object;
                getPublicInstance(node: object): object;
                detachDeletedInstance(node: object): void;
            };
            const node = {};
            const record = { pixi: { create: () => node, publicInstance: (instance: unknown) => instance } };
            const runtime = { nodeInfo: (instance: unknown) => (instance === node ? { root: record } : undefined) };
            const container = { record, runtime } as unknown as HostContainer<PixiTypes>;

            config.createInstance('pixiContainer', {}, container);

            expect(config.getPublicInstance(node)).toBe(node);

            config.detachDeletedInstance(node);

            expect(() => config.getPublicInstance(node)).toThrow(/not owned/);
        });
    });

    describe(`createContainer (react-reconciler ${hostConfig.RECONCILER_VERSION})`, () =>
    {
        it('the installed bundle takes eight arguments, the seventh being onRecoverableError', () =>
        {
            expect(installedParameters(require)).toEqual([
                'containerInfo',
                'tag',
                'hydrationCallbacks',
                'isStrictMode',
                'concurrentUpdatesByDefaultOverride',
                'identifierPrefix',
                'onRecoverableError',
                'transitionCallbacks',
            ]);
        });

        it('the root factory creates a ConcurrentRoot and routes onRecoverableError, not the React 19 callbacks', () =>
        {
            let recorded: unknown[] = [];
            const reconciler = {
                createContainer: (...args: unknown[]) =>
                {
                    recorded = args;

                    return {};
                },
            };
            const callbacks: RootCallbacks = { onRecoverableError: () => undefined };

            hostConfig.createContainer(reconciler as never, {} as HostContainer<PixiTypes>, callbacks, 'prefix');

            expect(recorded).toHaveLength(8);
            expect(recorded[1]).toBe(1); // ConcurrentRoot
            expect(recorded[3]).toBe(false); // not a StrictMode root: StrictMode comes from the tree
            expect(recorded[5]).toBe('prefix');
            expect(recorded[6]).toBe(callbacks.onRecoverableError);
            expect(recorded[7]).toBeNull();
        });
    });

    describe('payload-based updates', () =>
    {
        it('prepareUpdate reports a change only for scene props, never for children alone', () =>
        {
            const draw = () => undefined;

            expect(hostConfig.prepareUpdate({ x: 1, children: 'a' }, { x: 1, children: 'b' })).toBeNull();
            expect(hostConfig.prepareUpdate({ x: 1 }, { x: 2 })).toBe(hostConfig.UPDATE_PAYLOAD);
            expect(hostConfig.prepareUpdate({ x: 1 }, {})).toBe(hostConfig.UPDATE_PAYLOAD);
            expect(hostConfig.prepareUpdate({}, { x: undefined })).toBe(hostConfig.UPDATE_PAYLOAD);
            expect(hostConfig.prepareUpdate({ draw }, { draw })).toBeNull();
            expect(hostConfig.prepareUpdate({ draw }, { draw: () => undefined })).toBe(hostConfig.UPDATE_PAYLOAD);
            expect(hostConfig.prepareUpdate({ x: Number.NaN }, { x: Number.NaN })).toBeNull();
        });

        it('commitUpdate forwards previous and next props (not the payload) to the scene', () =>
        {
            const updates: unknown[] = [];
            const node = {};
            const record = { pixi: { create: () => node, update: (...args: unknown[]) => updates.push(args) } };
            const runtime = { nodeInfo: (target: unknown) => (target === node ? { root: record } : undefined) };
            const container = { runtime, record } as unknown as HostContainer<PixiTypes>;
            const config = hostConfig.createHostConfig() as {
                createInstance(type: string, props: object, container: HostContainer<PixiTypes>): object;
                commitUpdate(node: object, payload: unknown, type: string, previous: object, next: object, fiber: null): void;
            };

            expect(config.createInstance('pixiContainer', {}, container)).toBe(node);
            config.commitUpdate(node, hostConfig.UPDATE_PAYLOAD, 'pixiContainer', { x: 1 }, { x: 2 }, null);

            expect(updates).toEqual([[node, { x: 1 }, { x: 2 }]]);
        });
    });

    describe('event priority (getCurrentEventPriority)', () =>
    {
        const withEvent = (type: string | undefined, read: () => number) =>
        {
            const descriptor = Object.getOwnPropertyDescriptor(window, 'event');

            Object.defineProperty(window, 'event', { configurable: true, get: () => (type ? { type } : undefined) });

            try
            {
                return read();
            }
            finally
            {
                if (descriptor)
                {
                    Object.defineProperty(window, 'event', descriptor);
                }
                else
                {
                    delete (window as { event?: unknown }).event;
                }
            }
        };

        it('maps discrete and continuous DOM events to the React 18 lanes, and defaults otherwise', () =>
        {
            expect(withEvent('pointerdown', hostConfig.getCurrentEventPriority)).toBe(1);
            expect(withEvent('click', hostConfig.getCurrentEventPriority)).toBe(1);
            expect(withEvent('pointermove', hostConfig.getCurrentEventPriority)).toBe(4);
            expect(withEvent('wheel', hostConfig.getCurrentEventPriority)).toBe(4);
            expect(withEvent('message', hostConfig.getCurrentEventPriority)).toBe(16);
            expect(withEvent(undefined, hostConfig.getCurrentEventPriority)).toBe(16);
        });

        it('uses the constants of the reconciler it depends on', () =>
        {
            const constants = require('react-reconciler/constants');

            expect([constants.DiscreteEventPriority, constants.ContinuousEventPriority, constants.DefaultEventPriority])
                .toEqual([1, 4, 16]);
            expect(constants.ConcurrentRoot).toBe(1);
        });
    });

    describe('adapter', () =>
    {
        const Adapter = entry.React18Adapter;

        it('exports its class as React18Adapter and as its own name, over the shared base', () =>
        {
            const named = (entry as unknown as Record<string, unknown>)[`React${epoch.replace('.', '')}Adapter`];

            expect(named).toBe(Adapter);
            expect(new Adapter()).toBeInstanceOf(entry.React18AdapterBase);
        });

        it('declares an ABI 1 manifest with its minor, the Pixi capabilities it needs and its tested tuple', () =>
        {
            const { manifest: adapterManifest } = new Adapter() as { manifest: Record<string, unknown> };

            expect(adapterManifest.abi).toEqual({ major: 1, minor: 0 });
            expect(adapterManifest.id).toBe(`react-${epoch}`);
            expect(adapterManifest.packageVersion).toBe(manifest.version);
            expect(adapterManifest.requires).toEqual({
                'pixi.mutation': 1,
                'pixi.visibility': 1,
                'pixi.application': 1,
                'pixi.ticker': 1,
            });
            // React 18 has no Activity: the capability the 19.2+ epochs provide is absent here.
            expect(adapterManifest.provides).toEqual({});
            expect(adapterManifest.verification).toContain(manifest.name);
            expect(adapterManifest.verification).toContain(`react-reconciler ${hostConfig.RECONCILER_VERSION}`);
            expect(adapterManifest.verification).toContain(`its-fine ${manifest.dependencies['its-fine']}`);

            for (const version of entry.EPOCH.testedReact)
            {
                expect(adapterManifest.verification).toContain(version);
            }
        });

        it('declares the React 19 capabilities it lacks', () =>
        {
            expect(Object.keys(entry.UNSUPPORTED_CAPABILITIES).sort()).toEqual(['react.activity', 'react.root-error-callbacks']);

            for (const capability of Object.keys(entry.UNSUPPORTED_CAPABILITIES))
            {
                expect((new Adapter() as { manifest: { provides: object } }).manifest.provides).not.toHaveProperty(capability);
            }
        });

        it('accepts any patch of its own React minor', () =>
        {
            expect(() => withReact(Adapter, `${epoch}.0`).checkEnvironment()).not.toThrow();
            expect(() => withReact(Adapter, `${epoch}.42`).checkEnvironment()).not.toThrow();
        });

        it('rejects another React minor with UNSUPPORTED_TUPLE, naming the package to install for React 18 and 19', () =>
        {
            for (const other of ['17.0.2', '18.0.0', '18.1.0', '18.2.0', '18.3.1', '19.0.0', '19.1.0', '19.3.0', '20.0.0'])
            {
                if (other.startsWith(`${epoch}.`))
                {
                    continue;
                }

                let failure: unknown;

                try
                {
                    withReact(Adapter, other).checkEnvironment();
                }
                catch (error)
                {
                    failure = error;
                }

                expect(failure, other).toBeInstanceOf(CompatibilityError);
                expect((failure as CompatibilityError).code).toBe('UNSUPPORTED_TUPLE');
                expect((failure as CompatibilityError).adapterIds).toEqual([`react-${epoch}`]);
                expect((failure as CompatibilityError).actual).toEqual({ react: other });
                expect((failure as CompatibilityError).expected).toMatchObject({ react: `${epoch}.x`, reconciler: hostConfig.RECONCILER_VERSION });
                expect((failure as Error).message).toContain(`supports React ${epoch}.x`);

                const sibling = `@pixi-react-provisional/react-${other.split('.').slice(0, 2).join('.')}`;

                if ((/^1[89]\./).test(other))
                {
                    expect((failure as Error).message).toContain(sibling);
                }
                else
                {
                    expect((failure as Error).message).not.toContain(sibling);
                }
            }
        });

        it('keeps EPOCH.packageName and packageVersion equal to package.json', () =>
        {
            expect(entry.EPOCH.packageName).toBe(manifest.name);
            expect(entry.EPOCH.packageVersion).toBe(manifest.version);
            expect(manifest.name).toBe(`@pixi-react-provisional/react-${epoch}`);
        });

        it('declares an exact React peer: exactly the tested versions (D5)', () =>
        {
            expect(manifest.peerDependencies).toEqual({ react: entry.EPOCH.testedReact.join(' || ') });
        });

        it('pins the reconciler and bridge it depends on, exactly', () =>
        {
            expect(manifest.dependencies['react-reconciler']).toBe(entry.EPOCH.reconciler);
            expect(manifest.dependencies['its-fine']).toBe(entry.EPOCH.bridge);
        });
    });

    describe('built package', () =>
    {
        const dist = (path: string) => join(pkg.packageDir, 'dist', path);
        const script = join(dirname(require.resolve('@pixi-react-provisional/react-shared/package.json')), 'test-support', 'entries.mjs');
        const report = JSON.parse(execFileSync(process.execPath, [script, pkg.packageDir], { encoding: 'utf8' }));

        it('same names and identical values from import and require (D6)', () =>
        {
            expect(report.esmExports).toEqual(report.cjsExports);
            expect(report.esmExports).toEqual(expect.arrayContaining([
                'React18Adapter',
                'React18AdapterBase',
                `React${epoch.replace('.', '')}Adapter`,
                'EPOCH',
                'UNSUPPORTED_CAPABILITIES',
            ]));
            expect(report.differing).toEqual([]);
            expect(report.sameAdapterClass).toBe(true);
            expect(report.implementationFiles).toEqual(['dist/index.js']);
        });

        it('resolves its exact react-reconciler and its-fine dependencies at runtime instead of bundling them', () =>
        {
            expect(report.resolved['react-reconciler']).toBe(manifest.dependencies['react-reconciler']);
            expect(report.resolved['its-fine']).toBe(manifest.dependencies['its-fine']);
            expect(report.reconcilerLoaded).toBe(true);
        });

        it('loads without a DOM', () =>
        {
            expect(report.hasDom).toBe(false);
        });

        it('exports one entry: no subpaths, no aggregate', () =>
        {
            expect(Object.keys(manifest.exports).sort()).toEqual(['.', './package.json']);
        });

        it('declares exactly core, react-reconciler and its-fine, pinned, and only react as a peer', () =>
        {
            expect(manifest.dependencies).toEqual({
                '@pixi-react-provisional/core': 'workspace:*', // published as the exact same version: lockstep (design/release.md)
                'its-fine': '1.2.5',
                'react-reconciler': hostConfig.RECONCILER_VERSION,
            });
            expect(Object.keys(manifest.peerDependencies)).toEqual(['react']);
        });

        it('bundles only its own code: no reconciler, scheduler or its-fine source, no react-shared import', () =>
        {
            const code = readFileSync(dist('index.js'), 'utf8');

            expect(code).not.toMatch(/reconcilerVersion|unstable_scheduleCallback|\$\$\$hostConfig/);
            expect(code).toMatch(/require\("react-reconciler"\)/);
            expect(code).toMatch(/require\("its-fine"\)/);
            expect(code).not.toMatch(/require\(["'](scheduler|react-dom)/);
            expect(code).not.toContain('@pixi-react-provisional/react-shared');
            // No React 19 reconciler API leaked into the bundle.
            expect(code).not.toMatch(/updateContainerSync|onDefaultTransitionIndicator/);
        });

        it('publishes declarations that name no reconciler and no unpublished package', () =>
        {
            const declarations = readdirSync(dist(''), { recursive: true }).map(String).filter((file) => (/\.d\.m?ts$/).test(file));

            expect(declarations).toContain('index.d.ts');
            expect(declarations).not.toContain('hostConfig.d.ts');

            for (const file of declarations)
            {
                const text = readFileSync(dist(file), 'utf8');

                expect(text, file).not.toMatch(/(?:from |import\()['"](?:react-reconciler|its-fine|scheduler|#reconciler|@pixi-react-provisional\/react-shared)/);
            }
        });
    });
}
