import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const checker = resolve(packageDir, '../../scripts/check-dependency-graph.mjs');
const run = (allow: string[]) => spawnSync(
    process.execPath,
    [checker, ...allow.flatMap((name) => ['--allow', name])],
    { cwd: packageDir, encoding: 'utf8' },
);

describe('built dependency graph', () =>
{
    it('reaches only core and pixi.js: no React, reconciler or its-fine, at runtime or in declarations', () =>
    {
        const result = run(['@pixi-react-provisional/core', 'pixi.js']);

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
    });

    it('pixi.js is a peer, and every pixi.js import is confined to this package\'s entry points and declarations', () =>
    {
        const result = run(['@pixi-react-provisional/core']);
        const imports = result.stderr.split('\n')
            .filter((line) => (/\.m?js: import "pixi\.js"/).test(line))
            .map((line) => line.trim().split(':')[0])
            .sort();

        expect(result.status).toBe(1);
        // Runtime imports: only the two entry points bind pixi.js; every other module uses `import type`.
        expect(imports).toEqual(['dist/cjs/index.js', 'dist/esm/index.mjs']);
    });

    it('declares no runtime dependency other than core', () =>
    {
        const manifest = JSON.parse(readFileSync(resolve(packageDir, 'package.json'), 'utf8'));

        expect(Object.keys(manifest.dependencies)).toEqual(['@pixi-react-provisional/core']);
        expect(Object.keys(manifest.peerDependencies)).toEqual(['pixi.js']);
    });
});
