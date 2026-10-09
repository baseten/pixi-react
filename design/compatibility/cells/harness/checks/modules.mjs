// ESM/CJS import, ABI and capability check, run inside one isolated cell with plain Node: no bundler, no alias.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const cell = JSON.parse(readFileSync('cell.json', 'utf8'));
const require = createRequire(`${process.cwd()}/`);
const problems = [];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (message) => problems.push(message);

/** Loads an adapter entry the way a consumer of `format` would. */
const load = async (format, spec) => (format === 'esm' ? await import(spec) : require(spec));

async function check(role, adapter)
{
    const classes = {};

    for (const format of cell.formats)
    {
        let module;

        try
        {
            module = await load(format, adapter.spec);
        }
        catch (error)
        {
            fail(`${role}: ${format} import of ${adapter.spec} failed: ${error.message}`);
            continue;
        }
        const Class = module[adapter.className];

        if (typeof Class !== 'function')
        {
            fail(`${role}: ${format} ${adapter.spec} does not export ${adapter.className}`);
            continue;
        }
        classes[format] = Class;
        let instance;

        try
        {
            instance = new Class();
        }
        catch (error)
        {
            fail(`${role}: ${format} new ${adapter.className}() threw: ${error.message}`);
            continue;
        }
        const { manifest } = instance;

        if (manifest.id !== adapter.adapterId) fail(`${role}: ${format} manifest id ${manifest.id}, expected ${adapter.adapterId}`);
        if (!same(manifest.abi, adapter.abi)) fail(`${role}: ${format} ABI ${JSON.stringify(manifest.abi)}, expected ${JSON.stringify(adapter.abi)}`);
        if (adapter.provides && !same(Object.entries(manifest.provides).sort(), Object.entries(adapter.provides).sort())) fail(`${role}: ${format} provides ${JSON.stringify(manifest.provides)}, expected ${JSON.stringify(adapter.provides)}`);
        if (adapter.requires && !same(Object.entries(manifest.requires).sort(), Object.entries(adapter.requires).sort())) fail(`${role}: ${format} requires ${JSON.stringify(manifest.requires)}, expected ${JSON.stringify(adapter.requires)}`);
        if (adapter.info)
        {
            const actual = module[adapter.info.export]?.[adapter.info.field];

            if (actual !== adapter.info.expected) fail(`${role}: ${format} ${adapter.info.export}.${adapter.info.field} is ${actual}, expected ${adapter.info.expected}`);
        }
        try
        {
            instance.checkEnvironment();
        }
        catch (error)
        {
            // Print the adapter's own message and code: this is what a consumer sees, and it must say what to do.
            fail(`${role}: ${format} ${adapter.className}.checkEnvironment() rejected this installation (${error.code ?? error.details?.code ?? error.name}):\n      ${error.message}`);
        }
    }
    if (adapter.sameClassAcrossFormats && classes.esm && classes.cjs && classes.esm !== classes.cjs) fail(`${role}: the ESM and CJS entries of ${adapter.spec} export different ${adapter.className} classes (D6 requires one canonical runtime)`);

    return classes;
}

const react = await check('react adapter', cell.adapters.react);
const pixi = await check('pixi adapter', cell.adapters.pixi);

if (!problems.length)
{
    // Composition: the factory negotiates ABI and capabilities between the two adapters before anything is allocated.
    for (const format of cell.formats)
    {
        try
        {
            const { createRenderer } = await load(format, '@pixi-react-provisional/renderer');
            const renderer = createRenderer({ react: new react[format](), pixi: new pixi[format]() });

            if (renderer.runtime.roots().length !== 0) fail(`${format}: a new renderer already holds roots`);
        }
        catch (error)
        {
            fail(`${format}: createRenderer rejected the composition (${error.code ?? error.details?.code ?? error.name}): ${error.message}`);
        }
    }
}

if (problems.length)
{
    console.error(`Module check failed:\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
}
console.log(`modules: ok (${cell.formats.join(' + ')}; ${cell.adapters.react.spec} ${cell.adapters.react.className}, ${cell.adapters.pixi.spec} ${cell.adapters.pixi.className})`);
