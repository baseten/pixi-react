/* eslint-disable no-console -- run inside a consumer project; its output is the report. */
// Runs inside one clean consumer project (scripts/release/consumers.mjs) with plain Node: no bundler, no alias, no
// workspace. It loads the installed release packages through `import` and `require` the way an application would.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const scenario = JSON.parse(readFileSync('scenario.json', 'utf8'));
const require = createRequire(`${process.cwd()}/`);
const problems = [];
const notes = [];
const fail = (message) => problems.push(message);
const load = async (format, spec) => (format === 'esm' ? await import(spec) : require(spec));
const keys = (module) => Object.keys(module).filter((key) => key !== 'default' && key !== '__esModule').sort();

for (const spec of scenario.loadOnly ?? [])
{
    const shapes = {};

    for (const format of ['esm', 'cjs'])
    {
        try
        {
            shapes[format] = keys(await load(format, spec));
        }
        catch (error)
        {
            fail(`${format} load of ${spec} failed: ${error.message}`);
        }
    }
    if (shapes.esm && shapes.cjs && shapes.esm.join() !== shapes.cjs.join()) fail(`${spec}: ESM exports ${shapes.esm} differ from CJS exports ${shapes.cjs}`);
    for (const name of scenario.expectExports?.[spec] ?? []) if (shapes.esm && !shapes.esm.includes(name)) fail(`${spec} does not export ${name}`);
    if (shapes.esm) notes.push(`${spec}: ${shapes.esm.length} exports, identical through import and require`);
}

if (scenario.facade)
{
    for (const format of ['esm', 'cjs'])
    {
        try
        {
            const facade = await load(format, scenario.facade);
            const pixi = await load(format, 'pixi.js');

            // Registration through the default runtime: must not throw and must keep returning nothing (upstream parity).
            if (facade.extend({ Container: pixi.Container, Sprite: pixi.Sprite }) !== undefined) fail(`${format}: extend returned a value`);
        }
        catch (error)
        {
            fail(`${format}: the facade could not register constructors: ${error.message}`);
        }
    }
}

if (scenario.compose)
{
    const { renderer, react, pixi } = scenario.compose;

    for (const format of ['esm', 'cjs'])
    {
        try
        {
            const { createRenderer } = await load(format, renderer);
            const ReactAdapter = (await load(format, react.spec))[react.className];
            const PixiAdapter = (await load(format, pixi.spec))[pixi.className];
            const pixiModule = await load(format, 'pixi.js');
            const reactAdapter = new ReactAdapter();
            const pixiAdapter = new PixiAdapter();

            for (const [adapter, expected] of [[reactAdapter, react], [pixiAdapter, pixi]])
            {
                if (adapter.manifest.id !== expected.adapterId) fail(`${format}: manifest id ${adapter.manifest.id}, expected ${expected.adapterId}`);
                if (adapter.manifest.packageVersion !== expected.version) fail(`${format}: ${expected.spec} reports packageVersion ${adapter.manifest.packageVersion}, but its package is ${expected.version}`);
                if (adapter.manifest.abi.major !== scenario.abiMajor) fail(`${format}: ${expected.spec} implements ABI ${adapter.manifest.abi.major}, core is ABI ${scenario.abiMajor}`);
                if (String(adapter.manifest.certification ?? '').includes('provisional')) fail(`${format}: ${expected.spec} certification names a provisional package: ${adapter.manifest.certification}`);
            }
            const bound = createRenderer({ react: reactAdapter, pixi: pixiAdapter });

            bound.extend({ Container: pixiModule.Container, Sprite: pixiModule.Sprite });
            for (const name of ['pixiContainer', 'pixiSprite']) if (!bound.runtime.registry.has(name)) fail(`${format}: ${name} is not registered after extend`);
            notes.push(`${format}: createRenderer composed ${react.adapterId} + ${pixi.adapterId}; extend registered Container and Sprite`);
        }
        catch (error)
        {
            fail(`${format}: composition failed (${error.code ?? error.name}): ${error.message}`);
        }
    }
}

if (problems.length)
{
    console.error(`modules: FAILED\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
}
console.log(`modules: ok\n  ${notes.join('\n  ')}`);
