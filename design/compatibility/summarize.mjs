import { readFileSync, writeFileSync } from 'node:fs';
const input = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const results = input.results.map(row => {
    const runtime = row.runtime.stdout.trim().split('\n').findLast(line => line.startsWith('{'));
    const observation = runtime ? JSON.parse(runtime) : null;
    if (observation) delete observation.surfaces;
    const surfaces = Object.fromEntries(Object.entries(row.surfaces).filter(([path]) => /\/(?:Application|Container|ParticleContainer|Particle|Ticker|FederatedPointerEvent|Sprite|Text|extensions)\.d\.ts$|react-reconciler.development.js$|@types\/react\/index.d.ts$|its-fine\/dist\/index.js$/.test(path)));
    return { id: row.id, packages: row.packages, certification: row.certification, installExit: row.install.status, runtimeExit: row.runtime.status, typeExit: row.types.status, observation, failure: row.runtime.status ? row.runtime.stderr.replaceAll(/\/private\/tmp\/[^\s)]*?\/node_modules\//g, '<tuple>/node_modules/').split('\n').slice(0,12).join('\n') : undefined, typeDiagnostics: row.types.stdout || undefined, resolvedPackages: Object.fromEntries(Object.entries(row.lock.packages).filter(([path]) => path).map(([path, pkg]) => [path.replace(/^node_modules\//, ''), { version: pkg.version, integrity: pkg.integrity }])), surfaces };
});
let previousReact;
let previousPixi;
for (const row of results) {
    if (row.packages.react) {
        const keys = row.observation?.hostKeys || [];
        row.hostDelta = { added: keys.filter(k => !previousReact?.includes(k)), removed: (previousReact || []).filter(k => !keys.includes(k)) };
        previousReact = keys;
    } else {
        row.declarationDelta = Object.fromEntries(Object.entries(row.surfaces).filter(([path, surface]) => JSON.stringify(surface.declarations) !== JSON.stringify(previousPixi?.[path]?.declarations)).map(([path, surface]) => [path, { before: previousPixi?.[path]?.declarations || null, after: surface.declarations || null }]));
        previousPixi = row.surfaces;
    }
}
writeFileSync(process.argv[3], JSON.stringify({ schemaVersion: 1, observedAt: input.observedAt, node: input.node, platform: input.platform, limitations: ['No production adapter certificate', 'No GPU or DOM-to-Pixi matrix', 'TypeScript consumer checks use skipLibCheck', 'Runtime absence of errors covers only exercised paths'], results }, null, 2) + '\n');
