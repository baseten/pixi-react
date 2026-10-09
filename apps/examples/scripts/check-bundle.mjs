#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Proves the production build of the examples uses this repository's packages (issue 18). It reads
 * dist/module-graph.json, which the build writes (vite.config.ts), and fails unless:
 *
 * - the facade comes from packages/react/lib and the createRenderer route's packages from packages/<name>/dist: the
 *   built local artifacts, never a copy of @pixi/react or a modular package installed from a registry;
 * - no workspace package is bundled from its sources (packages/<name>/src);
 * - the bundle holds exactly one copy each of pixi.js, react and react-dom (the workspace packages keep other dev
 *   copies of pixi.js; vite.config.ts dedupes them), at the versions pinned in apps/docs/src/release-pins.json.
 *
 * Usage: node scripts/check-bundle.mjs (after `vite build`)
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const graphFile = fileURLToPath(new URL('../dist/module-graph.json', import.meta.url));
const pinsFile = fileURLToPath(new URL('../../docs/src/release-pins.json', import.meta.url));

if (!existsSync(graphFile))
{
    console.error(`${graphFile} is missing: run the examples build first (pnpm --filter @pixi-react-provisional/examples build)`);
    process.exit(1);
}

const { modules } = JSON.parse(readFileSync(graphFile, 'utf8'));
const pins = JSON.parse(readFileSync(pinsFile, 'utf8')).current.dependencies;
const problems = [];

/** Local packages and the built output each must be bundled from. */
const local = {
    '@pixi/react': 'packages/react/lib/',
    '@pixi-react-provisional/core': 'packages/core/dist/',
    '@pixi-react-provisional/renderer': 'packages/renderer/dist/',
    '@pixi-react-provisional/react-19.3': 'packages/react-19.3/dist/',
    '@pixi-react-provisional/pixi-8': 'packages/pixi-8/dist/',
};

for (const [name, prefix] of Object.entries(local))
{
    const count = modules.filter((id) => id.startsWith(prefix)).length;

    if (count === 0) problems.push(`${name}: no module from ${prefix} in the bundle`);
    else console.log(`${name}: ${count} modules from ${prefix}`);
}

// A registry copy lives under node_modules/.pnpm/<name>@<version>/; workspace links resolve to packages/<name>.
const registryCopies = modules.filter((id) => (/node_modules\/\.pnpm\/(?:@pixi\+react@|@pixi-react-provisional\+)/).test(id));

if (registryCopies.length) problems.push(`installed (non-workspace) copies of the library are bundled:\n  ${registryCopies.join('\n  ')}`);

const fromSources = modules.filter((id) => (/^packages\/[^/]+\/src\//).test(id));

if (fromSources.length) problems.push(`workspace sources are bundled instead of built output:\n  ${fromSources.join('\n  ')}`);

for (const name of ['pixi.js', 'react', 'react-dom'])
{
    const store = `${name.replace('/', '+')}@`;
    const versions = new Set(modules
        .filter((id) => id.startsWith(`node_modules/.pnpm/${store}`))
        .map((id) => id.slice(`node_modules/.pnpm/${store}`.length).split(/[_/(]/)[0]));
    const list = [...versions];

    if (list.length !== 1) problems.push(`${name}: expected one bundled copy, found ${list.join(', ') || 'none'}`);
    else if (list[0] !== pins[name]) problems.push(`${name}: bundled ${list[0]}, the docs pin is ${pins[name]}`);
    else console.log(`${name}: one copy, ${list[0]}`);
}

if (problems.length)
{
    console.error(`\nbundle check failed:\n- ${problems.join('\n- ')}`);
    process.exit(1);
}
console.log(`\nbundle check passed: ${modules.length} modules; the examples use the local workspace build.`);
