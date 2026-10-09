// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checker = resolve(packageDir, '../../scripts/check-dependency-graph.mjs');

function check(args: string[] = [], cwd = packageDir)
{
    return spawnSync(process.execPath, [checker, ...args], { cwd, encoding: 'utf8' });
}

function fixture(files: Record<string, string>): string
{
    const dir = mkdtempSync(join(tmpdir(), 'graph-'));

    mkdirSync(join(dir, 'dist'));
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture' }));

    for (const [name, text] of Object.entries(files))
    {
        writeFileSync(join(dir, 'dist', name), text);
    }

    return dir;
}

describe('built dependency graph', () =>
{
    it('core\'s runtime and declaration output imports nothing outside itself', () =>
    {
        const result = check();

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/@pixi-react-provisional\/core: \d+ built files; allowed external dependencies: none/);
    });

    it.each([
        ['a runtime import', 'index.js', 'const r = require("react-reconciler");'],
        ['a declaration import', 'index.d.ts', 'import type { ReactNode } from "react";\nexport type N = ReactNode;'],
        ['an import() type', 'index.d.ts', 'export type A = import("pixi.js").Application;'],
        ['a types reference', 'index.d.ts', '/// <reference types="react" />\nexport {};'],
        ['a computed require', 'index.js', 'const name = "its-fine"; module.exports = require(name);'],
        ['a path outside the build', 'index.js', 'require("../../src/index.ts");'],
    ])('the checker rejects %s', (_name, file, text) =>
    {
        const dir = fixture({ [file]: text });
        const result = check(['--package', dir]);

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/Dependency graph check failed/);
    });

    it('the checker rejects a forbidden package.json dependency', () =>
    {
        const dir = fixture({ 'index.js': 'module.exports = {};' });

        writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture', peerDependencies: { 'pixi.js': '^8' } }));

        expect(check(['--package', dir]).stderr).toMatch(/peerDependencies declares "pixi.js"/);
    });
});
