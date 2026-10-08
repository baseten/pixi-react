import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { declarationSeries } from './declaration-series.mjs';
import { resolvedPackagesFromLock } from './resolved-packages.mjs';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = input.results.map((row) =>
{
    declarationSeries(row);
    // Older runner output stays usable while it remains in its original audit directory.
    const workdir = row.workdir || join(dirname(realpathSync(process.argv[2])), row.id);
    const normalize = (text) => text?.replaceAll(`${pathToFileURL(workdir).href}/`, '<tuple>/').replaceAll(`${workdir}${sep}`, '<tuple>/');

    if (row.install.status !== 0)
    {
        const installDiagnostics = { ...row.install, stdout: normalize(row.install.stdout), stderr: normalize(row.install.stderr), error: normalize(row.install.error) };

        return { id: row.id, packages: row.packages, declarationSeries: row.declarationSeries, certification: row.certification, installExit: row.install.status, installDiagnostics, runtimeExit: null, typeExit: null, observation: null, resolvedPackages: {}, surfaces: {} };
    }
    const runtime = row.runtime.stdout.trim().split('\n').findLast((line) => line.startsWith('{'));
    const observation = runtime ? JSON.parse(runtime, (key, value) => (typeof value === 'string' ? normalize(value) : value)) : null;

    if (observation) delete observation.surfaces;
    const surfaces = Object.fromEntries(Object.entries(row.surfaces).map(([path, surface]) => [path.replaceAll('\\', '/'), surface]).filter(([path]) => (/\/(?:Application|Container|ParticleContainer|Particle|Ticker|FederatedPointerEvent|Sprite|Text|[Ee]xtensions)\.d\.ts$|@pixi\/extensions\/lib\/index\.d\.ts$|@pixi\/(?:extensions|app|display|sprite|text|ticker|interaction|events|assets|spritesheet|particles|particle-container|core)\/index.d.ts$|react-reconciler.development.js$|@types\/react\/index.d.ts$|its-fine\/dist\/index.js$/).test(path)));

    return { id: row.id, packages: row.packages, declarationSeries: row.declarationSeries, certification: row.certification, installExit: row.install.status, runtimeExit: row.runtime.status, typeExit: row.types.status, observation, failure: row.runtime.status ? normalize(row.runtime.stderr).split('\n').slice(0, 12).join('\n') : undefined, typeDiagnostics: normalize(row.types.stdout) || undefined, typeVariants: row.typeVariants ? Object.fromEntries(Object.entries(row.typeVariants).map(([name, result]) => [name, { status: result.status, stdout: normalize(result.stdout), stderr: normalize(result.stderr) }])) : undefined, resolvedPackages: resolvedPackagesFromLock(row.lock), surfaces };
});
let previousReact;
const previousPixi = new Map();

for (const row of results)
{
    if (row.installExit !== 0) continue;
    if (row.packages.react)
    {
        const keys = row.observation?.hostKeys || [];
        const previousKeys = previousReact || [];

        row.hostDelta = { added: keys.filter((k) => !previousKeys.includes(k)), removed: previousKeys.filter((k) => !keys.includes(k)) };
        previousReact = keys;
    }
    else
    {
        const series = declarationSeries(row);
        const previousSurfaces = previousPixi.get(series) || {};
        const paths = new Set([...Object.keys(row.surfaces), ...Object.keys(previousSurfaces)]);

        row.declarationDelta = Object.fromEntries([...paths].map((path) => [path, { before: previousSurfaces[path]?.declarations ?? null, after: row.surfaces[path]?.declarations ?? null }]).filter(([, delta]) => JSON.stringify(delta.before) !== JSON.stringify(delta.after)));
        previousPixi.set(series, row.surfaces);
    }
}
writeFileSync(process.argv[3], `${JSON.stringify({ schemaVersion: 1, observedAt: input.observedAt, node: input.node, platform: input.platform, limitations: ['No production adapter certificate', 'No GPU or DOM-to-Pixi matrix', 'TypeScript consumer checks use skipLibCheck', 'Runtime absence of errors covers only exercised paths'], results }, null, 2)}\n`);
