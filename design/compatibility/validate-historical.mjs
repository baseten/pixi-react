import assert from 'node:assert/strict';

export function validateHistoricalObservation(row, tuple)
{
    const observation = row.observation;
    const value = (path) => path.split('.').reduce((object, key) => object?.[key], observation);
    const check = (path, predicate) => assert.ok(predicate(value(path)), `${row.id}: observation.${path}`);
    const equal = (path, expected) => assert.deepEqual(value(path), expected, `${row.id}: observation.${path}`);
    const text = (item) => typeof item === 'string' && item.length > 0;
    const object = (item) => item !== null && typeof item === 'object' && !Array.isArray(item);
    const stringList = (item) => Array.isArray(item) && item.length > 0 && item.every(text);
    const hash = (item) => typeof item === 'string' && (/^[a-f0-9]{64}$/).test(item);

    if (tuple.kind === 'react')
    {
        equal('scheduler', tuple.packages.scheduler);
        equal('bridge', tuple.packages['its-fine']);
        equal('createContainerArity', 4);
        equal('updateContainerArity', 4);
        for (const [key, expected] of Object.entries({ contextBridge: 'mount-update-unmount', refs: 'attach-update-detach', state: 'synchronous-update', errorBoundary: 'historical-intentional-error', activity: 'not-available', fragmentRef: 'not-available' })) equal(`features.${key}`, expected);
        equal('features.effects', ['layout:initial', 'passive:initial', 'layout-cleanup:initial', 'layout:changed', 'passive-cleanup:initial', 'passive:changed', 'layout-cleanup:changed', 'passive-cleanup:changed']);
        equal('features.secondaryParentBridge.expected', 'secondary-parent');
        equal('features.secondaryParentBridge.actual', 'default');

        return;
    }
    const version = tuple.packages['pixi.js'];
    const [, minor, patch] = version.split('.').map(Number);
    const events = Boolean(tuple.packages['@pixi/events']);
    const assets = Boolean(tuple.packages['@pixi/assets']);
    const prefix = 'observations';
    const moduleExtension = minor >= 5 ? 'mjs' : 'js';
    let sourceNames = ['app', 'display', 'ticker', 'spritesheet'];

    if (events) sourceNames = ['events'];
    if (assets) sourceNames = ['assets'];
    const sourceField = assets ? 'publishedSources' : 'publishedBundles';
    const sources = value(`${prefix}.${sourceField}`);
    const expectedPaths = sourceNames.flatMap((name) => [`@pixi/${name}/dist/cjs/${name}.js`, `@pixi/${name}/dist/esm/${name}.${moduleExtension}`, `@pixi/${name}/dist/browser/${name}.js`, ...(assets ? [`@pixi/${name}/index.d.ts`] : [])]);

    equal('version', version);
    check(`${prefix}.${sourceField}`, object);
    assert.deepEqual(Object.keys(sources).sort(), expectedPaths.sort(), `${row.id}: observation.${prefix}.${sourceField} paths`);
    for (const [path, source] of Object.entries(sources))
    {
        assert.ok(hash(source?.sha256) && Number.isSafeInteger(source.bytes) && source.bytes > 0, `${row.id}: observation.${prefix}.${sourceField}.${path}`);
        if (!events && !assets)
        {
            assert.equal(source.packageVersion, version, `${row.id}: observation.${prefix}.${sourceField}.${path}.packageVersion`);
            assert.ok(Array.isArray(source.embeddedCoreDefinitions) && source.embeddedCoreDefinitions.every((name) => ['BaseTexture', 'Texture', 'Renderer'].includes(name)), `${row.id}: observation.${prefix}.${sourceField}.${path}.embeddedCoreDefinitions`);
        }
    }
    if (row.runtimeExit === 0)
    {
        equal('capabilities', {
            asyncInit: false,
            particle: false,
            particleContainer: true,
            cacheAsTexture: false,
            renderLayer: false,
            domContainer: false,
            canvasRenderer: false,
            interactionManager: true,
            federatedEventsInDefaultBundle: false,
            assetsInDefaultBundle: false,
            loader: true,
            extensions: minor >= 5,
            ...(events ? { optionalFederatedEvents: true } : {}),
            ...(assets ? { optionalAssets: true } : {}),
        });
    }
    if (assets)
    {
        equal(`${prefix}.assets.version`, tuple.packages['@pixi/assets']);
        equal(`${prefix}.assets.methods`, ['init', 'load', 'unload', 'add', 'loadBundle']);
        equal(`${prefix}.assets.scope`, 'API presence only; no init, fetch, decoding, loading or rendering');

        return;
    }
    if (row.runtimeExit === 0)
    {
        const needsFixture = minor < 3 || (minor === 3 && patch === 0);

        equal(`${prefix}.unmodifiedNodeImport.exit`, needsFixture ? 1 : 0);
        equal(`${prefix}.unmodifiedNodeImport.diagnostic`, needsFixture ? `ReferenceError: ${minor < 3 ? 'self' : 'document'} is not defined` : null);
        check(`${prefix}.bootstrap`, Array.isArray);
        if (needsFixture)
        {
            equal(`${prefix}.bootstrap.0`, { operation: 'browser-global-import-fixture', globals: ['self', 'window', 'document', 'CanvasRenderingContext2D'], webgl: 'unavailable' });
            equal(`${prefix}.bootstrap.1`, { operation: 'import-time-fillRect', args: [0, 0, 16, 16] });
        }
        else equal(`${prefix}.bootstrap`, []);
    }
    if (events)
    {
        equal(`${prefix}.optionalEvents.version`, tuple.packages['@pixi/events']);
        equal(`${prefix}.optionalEvents.eventBoundary`, 'synthetic capture-target-bubble and listener removal');
        equal(`${prefix}.optionalEvents.received`, ['capture', 'target', 'bubble']);
        equal(`${prefix}.optionalEvents.scope`, 'explicit event target; no hit testing, DOM events or renderer EventSystem installation');
        equal(`${prefix}.optionalEvents.exports`, ['EventBoundary', 'EventSystem', 'FederatedDisplayObject', 'FederatedEvent', 'FederatedMouseEvent', 'FederatedPointerEvent', 'FederatedWheelEvent']);

        return;
    }
    const declarations = row.surfaces['@pixi/spritesheet/index.d.ts'];

    assert.ok(declarations, `${row.id}: observation.${prefix}.spritesheet source`);
    equal(`${prefix}.spritesheet.declarations.path`, '@pixi/spritesheet/index.d.ts');
    equal(`${prefix}.spritesheet.declarations.sha256`, declarations.sha256);
    check(`${prefix}.spritesheet.declarations.parseSignatures`, stringList);
    equal(`${prefix}.spritesheet.declarations.parseSignatures`, declarations.declarations.filter((line) => line.startsWith('parse(')));
    equal(`${prefix}.spritesheet.scope`, 'Texture.EMPTY with no frames; no image loading, texture upload or rendering');
    if (row.runtimeExit !== 0)
    {
        equal('capabilities', null);
        equal(`${prefix}.spritesheet.commonjs.exit`, patch === 0 ? 1 : 0);
        equal(`${prefix}.spritesheet.commonjs.diagnostic`, patch === 0 ? 'TypeError: isMobileCall is not a function' : null);
        equal(`${prefix}.spritesheet.commonjs.result`, patch === 0 ? null : { route: 'supplementary CommonJS require', callbacks: 1, returnType: 'undefined' });

        return;
    }
    equal(`${prefix}.spritesheet.runtime`, minor >= 5 ? { route: 'default ESM import', noArgumentReturn: 'Promise', resolvedTextureCount: 0 } : { route: 'default ESM import with recorded bootstrap where needed', callbacks: 1, callbackReturn: 'undefined' });
    equal(`${prefix}.scene`, 'construct-add-reorder-remove-properties-destroy');
    equal(`${prefix}.eventScope`, 'EventEmitter on/emit/off only; no DOM events, propagation or hit testing');
    equal(`${prefix}.particleContainer`, 'Sprite children; no Particle class');
    equal(`${prefix}.application`, { constructorArity: 1, initMethod: 'undefined', destroyMethod: 'function', registerPlugin: 'function', registeredPlugins: ['ResizePlugin', 'TickerPlugin', 'AppLoaderPlugin'], resizeScope: 'registered ResizePlugin and consumer types only; no real renderer or resize events', runtimeConstruction: 'not-exercised-requires-renderer' });
    equal(`${prefix}.ticker.callback`, 'numeric deltaTime');
    equal(`${prefix}.ticker.scheduling`, 'manual update calls only');
    check(`${prefix}.ticker.samples`, (samples) => Array.isArray(samples) && samples.length === 2 && samples.every((sample) => ['argument', 'deltaMS', 'elapsedMS'].every((key) => Number.isFinite(sample?.[key]) && sample[key] > 0)));
    equal(`${prefix}.ticker.samples.1.elapsedMS`, 16);
    equal(`${prefix}.destruction.publicDestroyedAfterDestroy`, minor === 0 ? null : true);
    equal(`${prefix}.destruction.events`, minor === 0 ? [] : [{ publicDestroyedDuringEvent: minor >= 4 }]);
    const embedded = Object.entries(sources).filter(([path, source]) => path.startsWith('@pixi/ticker/') && source.embeddedCoreDefinitions.length > 0).map(([path]) => path);

    equal(`${prefix}.packaging`, embedded.length > 0 ? { status: 'embedded-core-definitions', errors: ['ticker embeds core implementation'], inspectedPaths: embedded } : { status: 'no-core-definitions-in-inspected-ticker' });
    assert.equal(embedded.length > 0, version === '6.5.0', `${row.id}: observation.${prefix}.packaging version boundary`);
}
