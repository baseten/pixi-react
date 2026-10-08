// Standalone installed-consumer audit. No repository dependency tree is reused.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(readFileSync(join(here, 'seed.json')));
const root = process.env.AUDIT_WORKDIR || mkdtempSync(join(tmpdir(), 'pixi-version-audit-'));

mkdirSync(root, { recursive: true });
const results = [];
const filter = process.argv[2];

for (const tuple of manifest.probes.filter((t) => !filter || t.id.includes(filter)))
{
    const cwd = join(root, tuple.id);

    mkdirSync(cwd, { recursive: true });
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ private: true, type: 'module', dependencies: tuple.packages }));
    const run = (command, args) =>
    {
        const r = spawnSync(command, args, { cwd, encoding: 'utf8', timeout: 180000, env: { ...process.env, NODE_ENV: 'development' }, maxBuffer: 8 * 1024 * 1024 });

        return { status: r.status, signal: r.signal, error: r.error?.message, stdout: r.stdout, stderr: r.stderr };
    };
    const reuse = process.env.AUDIT_REUSE_INSTALL === '1' && Object.entries(tuple.packages).every(([name, version]) =>
    {
        const path = join(cwd, 'node_modules', name, 'package.json');

        return existsSync(path) && JSON.parse(readFileSync(path)).version === version;
    });
    const install = reuse ? { status: 0, reused: true } : run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', process.env.AUDIT_NPM_CACHE || join(root, 'cache')]);
    const row = { id: tuple.id, packages: tuple.packages, workdir: realpathSync(cwd), install, certification: 'not-certified' };

    if (install.status === 0)
    {
        for (const name of [`${tuple.kind}.mjs`, `${tuple.kind}.tsx`]) copyFileSync(join(here, name), join(cwd, name));
        const typeFiles = [`${tuple.kind}.tsx`];
        const [major, minor] = (tuple.packages.react || tuple.packages['pixi.js']).split('.').map(Number);
        let extras = [];

        if (tuple.kind === 'pixi') extras = [major === 7 ? 'pixi7.tsx' : 'pixi8.tsx', ...(major === 8 && minor >= 5 ? ['particle.tsx'] : [])];
        else if (major === 19) extras = ['react19.tsx', ...(minor >= 2 ? ['react192.tsx'] : []), ...(minor >= 3 ? ['react193.tsx'] : [])];

        for (const file of extras)
        {
            copyFileSync(join(here, file), join(cwd, file));
            typeFiles.push(file);
        }
        writeFileSync(join(cwd, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true, skipLibCheck: true, target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', jsx: 'react-jsx', lib: ['ES2022', 'DOM'], types: tuple.kind === 'react' ? ['react'] : [] }, files: typeFiles }));
        row.runtime = run(process.execPath, [`${tuple.kind}.mjs`]);
        row.types = run(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json']);
        // Keep the actual transitive resolutions/integrities alongside the result.
        row.surfaces = {};
        let roots = ['react-reconciler', '@types/react', 'its-fine'];

        if (tuple.kind === 'pixi') roots = major === 7 ? ['@pixi/app', '@pixi/display', '@pixi/sprite', '@pixi/text', '@pixi/ticker', '@pixi/events', '@pixi/particle-container', '@pixi/extensions'] : ['pixi.js'];
        const scan = (dir) =>
        {
            for (const entry of readdirSync(dir, { withFileTypes: true }))
            {
                const path = join(dir, entry.name);

                if (entry.isDirectory()) scan(path);
                else if ((/\.(d\.ts|mjs|js)$/).test(path) && !path.endsWith('.production.js') && ((/Application|Container|Particle|Ticker|Federated|Extension|Sprite|Text|global|@pixi[/\\]extensions[/\\]lib[/\\]index\.d\.ts$/).test(path) || (tuple.kind === 'react' && (/index\.d\.ts$|react-reconciler.development.js$|its-fine.*index.js$/).test(path))))
                {
                    const text = readFileSync(path, 'utf8');

                    row.surfaces[path.slice(join(cwd, 'node_modules').length + 1)] = { sha256: createHash('sha256').update(text).digest('hex'), declarations: path.endsWith('.d.ts') ? text.split('\n').filter((l) => (/^\s*(constructor\(|(?:init|destroy|addChild|addParticle|removeParticles|removeChildren|updateTransform|on|add|remove|visible|parent|createContainer|Fragment|ViewTransition)[<(?: :])/).test(l)).map((l) => l.trim()) : undefined };
                }
            }
        };

        for (const name of roots) scan(join(cwd, 'node_modules', name));
        row.lock = JSON.parse(readFileSync(join(cwd, 'package-lock.json')));
    }
    results.push(row);
    writeFileSync(join(root, 'results.json'), `${JSON.stringify({ node: process.version, platform: process.platform, observedAt: new Date().toISOString(), results }, null, 2)}\n`);
    process.stdout.write(`${tuple.id} install ${install.status} runtime ${row.runtime?.status} types ${row.types?.status}\n`);
}
process.stdout.write(`Evidence directory: ${root}\n`);
if (results.some((r) => r.install.status !== 0 || r.runtime?.status !== 0 || r.types?.status !== 0)) process.exitCode = 1;
