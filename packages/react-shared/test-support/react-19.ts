/**
 * The unit suite every React 19 minor package runs against its own sources and its own build (issue 49): the host-key
 * audit against the installed reconciler, the root factory's argument shape, the one shared reconciler, the
 * environment check and manifest, and the built package (D6 single instance, dependencies instead of bundled code).
 *
 * Each package calls `describeReact19Package` from `test/package.test.ts` with its own modules; nothing here imports
 * a per-minor package.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CompatibilityError, type PixiTypes } from '@pixi-react-provisional/core';

import type { EpochInfo } from '../src/react-19/adapter';
import type { EpochRootCallbacks, HostContainer } from '../src/react-19/host';

type RootFactory = (reconciler: never, container: HostContainer<PixiTypes>, callbacks: EpochRootCallbacks, prefix: string) => unknown;

interface HostConfigModule
{
    readonly RECONCILER_VERSION: string;
    readonly UNREACHABLE_HOST_KEYS: Readonly<Record<string, string>>;
    createHostConfig(): object;
    createContainer: RootFactory;
    sharedReconciler(): unknown;
    readonly onDefaultTransitionIndicator?: () => void;
}

interface EntryModule
{
    readonly EPOCH: EpochInfo;
    readonly React19Adapter: new () => object;
    readonly React19AdapterBase: abstract new () => object;
}

export interface React19PackageUnderTest
{
    /** The package directory (where its package.json is). */
    readonly packageDir: string;
    readonly hostConfig: HostConfigModule;
    readonly entry: EntryModule;
    /** The name of `createContainer`'s tenth parameter in the installed reconciler. */
    readonly rootArgument10: 'transitionCallbacks' | 'onDefaultTransitionIndicator';
}

/** Host-config keys the installed bundle reads (`$$$config.<key>`), in its development and production builds. */
function bundleKeys(require: NodeRequire): { development: string[]; production: string[] }
{
    const dir = dirname(require.resolve('react-reconciler/package.json'));
    const read = (build: string) => [
        ...new Set([...readFileSync(join(dir, 'cjs', `react-reconciler.${build}.js`), 'utf8')
            .matchAll(/\$\$\$config\.([A-Za-z_$][\w$]*)/g)].map((match) => match[1])),
    ].sort();

    return { development: read('development'), production: read('production') };
}

/** The `createContainer` parameter names of the installed production bundle. */
function installedParameters(require: NodeRequire): string[]
{
    const file = join(dirname(require.resolve('react-reconciler/package.json')), 'cjs', 'react-reconciler.production.js');
    const match = (/exports\.createContainer = function \(([^)]*)\)/).exec(readFileSync(file, 'utf8'));

    return match![1].split(',').map((name) => name.trim()).filter(Boolean);
}

/** Records the arguments a root factory passes to `createContainer`. */
function recordArguments(createContainer: RootFactory): unknown[]
{
    let recorded: unknown[] = [];
    const reconciler = {
        createContainer: (...args: unknown[]) =>
        {
            recorded = args;

            return {};
        },
    };
    const callbacks: EpochRootCallbacks = {
        onUncaughtError: () => undefined,
        onCaughtError: () => undefined,
        onRecoverableError: () => undefined,
    };

    createContainer(reconciler as never, {} as HostContainer<PixiTypes>, callbacks, 'prefix');

    return recorded;
}

/** The 0.31/0.32 root shape (argument 10 is `transitionCallbacks`, here `null`), for the negative check below. */
const transitionCallbacksShape: RootFactory = (reconciler, container, callbacks, prefix) =>
    (reconciler as { createContainer(...args: unknown[]): unknown }).createContainer(
        container, 1, null, false, null, prefix,
        callbacks.onUncaughtError, callbacks.onCaughtError, callbacks.onRecoverableError, null,
    );

/** The 0.33/0.34 contract for argument 10. Fails for the 0.31/0.32 shape, which passes `null` there. */
function expectIndicatorArgument(args: unknown[], indicator: unknown): void
{
    expect(args, 'argument count').toHaveLength(10);
    expect(typeof args[9], 'argument 10 is a function').toBe('function');
    expect(args[9], 'argument 10 is the package\'s default-transition-indicator handler').toBe(indicator);
}

function withReact<T extends new() => object>(Adapter: T, version: string): InstanceType<T> & { checkEnvironment(): void }
{
    const instance = new Adapter() as InstanceType<T> & { reactVersion(): string; checkEnvironment(): void };

    instance.reactVersion = () => version;

    return instance;
}

export function describeReact19Package(pkg: React19PackageUnderTest): void
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

        it('reads the same keys in development and production', () =>
        {
            expect(keys.production).toEqual(keys.development);
        });

        it('implements only keys the bundle reads (no copied hooks from another minor)', () =>
        {
            expect(implemented.filter((key) => !keys.development.includes(key))).toEqual([]);
        });

        it('implements or explains every key the bundle reads, and never both', () =>
        {
            expect(keys.development.filter((key) => !implemented.includes(key) && !unreachable.includes(key))).toEqual([]);
            expect(unreachable.filter((key) => !keys.development.includes(key))).toEqual([]);
            expect(implemented.filter((key) => unreachable.includes(key))).toEqual([]);
        });
    });

    describe('one shared reconciler per package copy (issue 49)', () =>
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

        it('traces a node to the runtime its container carries, and forgets it when React deletes it', () =>
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

            config.createInstance('fakeContainer', {}, container);

            expect(config.getPublicInstance(node)).toBe(node);

            config.detachDeletedInstance(node);

            expect(() => config.getPublicInstance(node)).toThrow(/not owned/);
        });
    });

    describe('createContainer argument shape', () =>
    {
        it(`the installed bundle takes ten arguments, the tenth being ${pkg.rootArgument10}`, () =>
        {
            expect(installedParameters(require)).toHaveLength(10);
            expect(installedParameters(require)[9]).toBe(pkg.rootArgument10);
        });

        if (pkg.rootArgument10 === 'transitionCallbacks')
        {
            it('passes ten arguments with transitionCallbacks = null', () =>
            {
                const args = recordArguments(hostConfig.createContainer);

                expect(args).toHaveLength(10);
                expect(args[1]).toBe(1); // ConcurrentRoot
                expect(args[5]).toBe('prefix');
                expect(args[9]).toBeNull();
            });
        }
        else
        {
            const indicator = hostConfig.onDefaultTransitionIndicator;

            it('passes onDefaultTransitionIndicator as argument 10', () =>
            {
                const args = recordArguments(hostConfig.createContainer);

                expect(args[1]).toBe(1);
                expect(args[6]).toEqual(expect.any(Function));
                expectIndicatorArgument(args, indicator);
                expect(indicator!()).toBeUndefined();
            });

            it('fails the argument-10 check if the 19.0/19.1 root shape were reused', () =>
            {
                expect(() => expectIndicatorArgument(recordArguments(transitionCallbacksShape), indicator)).toThrow();
            });
        }
    });

    describe('adapter', () =>
    {
        const Adapter = entry.React19Adapter;

        it('exports its class as React19Adapter and as its own name, over the shared base', () =>
        {
            const named = (entry as unknown as Record<string, unknown>)[`React${epoch.replace('.', '')}Adapter`];

            expect(named).toBe(Adapter);
            expect(new Adapter()).toBeInstanceOf(entry.React19AdapterBase);
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
            expect(adapterManifest.provides).toEqual(epoch >= '19.2' ? { 'react.activity': 1 } : {});
            expect(adapterManifest.verification).toContain(manifest.name);
            expect(adapterManifest.verification).toContain(`react-reconciler ${hostConfig.RECONCILER_VERSION}`);
            expect(adapterManifest.verification).toContain(`its-fine ${manifest.dependencies['its-fine']}`);

            for (const version of entry.EPOCH.testedReact)
            {
                expect(adapterManifest.verification).toContain(version);
            }
        });

        it('accepts any patch of its own React minor', () =>
        {
            expect(() => withReact(Adapter, `${epoch}.0`).checkEnvironment()).not.toThrow();
            expect(() => withReact(Adapter, `${epoch}.42`).checkEnvironment()).not.toThrow();
        });

        it('rejects another React minor (and React 18) with UNSUPPORTED_TUPLE naming the package to install', () =>
        {
            for (const other of ['18.3.1', '19.0.0', '19.1.0', '19.2.0', '19.3.0', '19.4.0', '20.0.0'])
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
                expect((failure as Error).message).toContain(`@pixi-react-provisional/react-${other.split('.').slice(0, 2).join('.')}`);
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
    });

    describe('built package', () =>
    {
        const dist = (path: string) => join(pkg.packageDir, 'dist', path);
        const script = join(dirname(require.resolve('@pixi-react-provisional/react-shared/package.json')), 'test-support', 'entries.mjs');
        const report = JSON.parse(execFileSync(process.execPath, [script, pkg.packageDir], { encoding: 'utf8' }));

        it('same names and identical values from import and require (D6)', () =>
        {
            expect(report.esmExports).toEqual(report.cjsExports);
            expect(report.esmExports).toEqual(
                expect.arrayContaining(['React19Adapter', 'React19AdapterBase', `React${epoch.replace('.', '')}Adapter`, 'EPOCH']),
            );
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
                'its-fine': '2.1.1',
                'react-reconciler': hostConfig.RECONCILER_VERSION,
            });
            expect(Object.keys(manifest.peerDependencies)).toEqual(['react']);
        });

        it('bundles only its own code: no reconciler, scheduler or its-fine source, no react-shared import', () =>
        {
            const code = readFileSync(dist('index.js'), 'utf8');

            expect(code).not.toMatch(/reconcilerVersion|unstable_scheduleCallback|\$\$\$config/);
            expect(code).toMatch(/require\("react-reconciler"\)/);
            expect(code).toMatch(/require\("its-fine"\)/);
            expect(code).not.toMatch(/require\("scheduler"\)/);
            expect(code).not.toContain('@pixi-react-provisional/react-shared');
        });

        it('publishes declarations that name no reconciler and no unpublished package', () =>
        {
            const declarations = readdirSync(dist(''), { recursive: true }).map(String).filter((file) => (/\.d\.m?ts$/).test(file));

            expect(declarations).toContain('index.d.ts');
            expect(declarations).not.toContain('hostConfig.d.ts');

            for (const file of declarations)
            {
                const text = readFileSync(dist(file), 'utf8');

                expect(text, file).not.toMatch(/(?:from |import\()['"](?:react-reconciler|scheduler|#reconciler|@pixi-react-provisional\/react-shared)/);
            }
        });
    });
}
