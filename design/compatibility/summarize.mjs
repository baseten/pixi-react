import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolvedPackagesFromLock } from './resolved-packages.mjs';

const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = input.results.map((row) =>
{
    // Older runner output stays usable while it remains in its original audit directory.
    const workdir = row.workdir || join(dirname(realpathSync(process.argv[2])), row.id);
    const normalize = (text) => (typeof text === 'string' ? text.replaceAll(`${pathToFileURL(workdir).href}/`, '<tuple>/').replaceAll(`${workdir}${sep}`, '<tuple>/') : text);

    if (row.install.status !== 0)
    {
        const installDiagnostics = { ...row.install, stdout: normalize(row.install.stdout), stderr: normalize(row.install.stderr), error: normalize(row.install.error) };

        return { id: row.id, packages: row.packages, certification: row.certification, installExit: row.install.status, installDiagnostics, runtimeExit: null, typeExit: null, observation: null, resolvedPackages: {}, surfaces: {} };
    }
    const runtime = (row.runtime.stdout ?? '').trim().split('\n').findLast((line) => line.startsWith('{'));
    let observation = null;

    if (runtime)
    {
        try
        {
            observation = JSON.parse(runtime, (key, value) => (typeof value === 'string' ? normalize(value) : value));
        }
        catch (error)
        {
            if (row.runtime.status === 0) throw error;
        }
    }
    const diagnostics = (result) => (result.status !== 0 ? { ...result, stdout: normalize(result.stdout), stderr: normalize(result.stderr), error: normalize(result.error) } : undefined);

    if (observation) delete observation.surfaces;
    const surfaces = Object.fromEntries(Object.entries(row.surfaces).map(([path, surface]) => [path.replaceAll('\\', '/'), surface]).filter(([path]) => (/\/(?:Application|Container|ParticleContainer|Particle|Ticker|FederatedPointerEvent|Sprite|Text|[Ee]xtensions)\.d\.ts$|@pixi\/extensions\/lib\/index\.d\.ts$|react-reconciler.development.js$|@types\/react\/index.d.ts$|its-fine\/dist\/index.js$/).test(path)));

    return { id: row.id, packages: row.packages, certification: row.certification, installExit: row.install.status, runtimeExit: row.runtime.status, typeExit: row.types.status, observation, runtimeDiagnostics: diagnostics(row.runtime), typeProcessDiagnostics: diagnostics(row.types), failure: row.runtime.status !== 0 ? (normalize(row.runtime.stderr) || '').split('\n').slice(0, 12).join('\n') : undefined, typeDiagnostics: normalize(row.types.stdout) || undefined, resolvedPackages: resolvedPackagesFromLock(row.lock), surfaces };
});
let previousReact;
let previousPixi;

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
        const previousSurfaces = previousPixi || {};
        const paths = new Set([...Object.keys(row.surfaces), ...Object.keys(previousSurfaces)]);

        row.declarationDelta = Object.fromEntries([...paths].map((path) => [path, { before: previousSurfaces[path]?.declarations ?? null, after: row.surfaces[path]?.declarations ?? null }]).filter(([, delta]) => JSON.stringify(delta.before) !== JSON.stringify(delta.after)));
        previousPixi = row.surfaces;
    }
}
writeFileSync(process.argv[3], `${JSON.stringify({ schemaVersion: 1, observedAt: input.observedAt, node: input.node, platform: input.platform, limitations: ['No production adapter certificate', 'No GPU or DOM-to-Pixi matrix', 'TypeScript consumer checks use skipLibCheck', 'Runtime absence of errors covers only exercised paths'], results }, null, 2)}\n`);
