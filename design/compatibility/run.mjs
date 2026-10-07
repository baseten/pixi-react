// Standalone installed-consumer audit. No repository dependency tree is reused.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'seed.json')));
const root = process.env.AUDIT_WORKDIR || mkdtempSync(join(tmpdir(), 'pixi-version-audit-'));
mkdirSync(root, { recursive: true });
const results = [];
const filter = process.argv[2];
for (const tuple of manifest.probes.filter(t => !filter || t.id.includes(filter))) {
    const cwd = join(root, tuple.id);
    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: tuple.packages }));
    const run = (command, args) => {
        const r = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180000, env: { ...process.env, NODE_ENV: 'development' }, maxBuffer: 8 * 1024 * 1024 });
        return { status: r.status, signal: r.signal, error: r.error?.message, stdout: r.stdout, stderr: r.stderr };
    };
    const install = run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', process.env.AUDIT_NPM_CACHE || join(root, 'cache')]);
    const row = { id: tuple.id, packages: tuple.packages, install, certification: 'not-certified' };
    if (install.status === 0) {
        for (const name of [`${tuple.kind}.mjs`, `${tuple.kind}.tsx`]) copyFileSync(join(here, name), join(cwd, name));
        writeFileSync(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'react-jsx', lib: ['ES2022', 'DOM'], types: tuple.kind === 'react' ? ['react'] : [] }, files: [`${tuple.kind}.tsx`] }));
        row.runtime = run(process.execPath, [`${tuple.kind}.mjs`]);
        row.types = run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
        // Keep the actual transitive resolutions/integrities alongside the result.
        row.lock = JSON.parse(readFileSync(join(cwd, 'package-lock.json')));
    }
    results.push(row);
    writeFileSync(join(root, 'results.json'), JSON.stringify({ node: process.version, platform: process.platform, observedAt: new Date().toISOString(), results }, null, 2) + '\n');
    console.log(tuple.id, 'install', install.status, 'runtime', row.runtime?.status, 'types', row.types?.status);
}
console.log('Evidence directory:', root);
if (results.some(r => r.install.status !== 0 || r.runtime?.status !== 0 || r.types?.status !== 0)) process.exitCode = 1;
