// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const packageDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const checker = resolve(packageDir, '../../scripts/check-dependency-graph.mjs');

describe('built dependency graph', () =>
{
    it('the renderer reaches only @pixi-react-provisional/core, in JS and declarations', () =>
    {
        const result = spawnSync(process.execPath, [checker, '--allow', '@pixi-react-provisional/core'], { cwd: packageDir, encoding: 'utf8' });

        expect(result.stderr).toBe('');
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/dist\/cjs\/index\.d\.ts -> @pixi-react-provisional\/core/);
    });

    it('fails without the core allowance, so the check is not vacuous', () =>
    {
        const result = spawnSync(process.execPath, [checker], { cwd: packageDir, encoding: 'utf8' });

        expect(result.status).toBe(1);
        expect(result.stderr).toMatch(/"@pixi-react-provisional\/core" is not an allowed dependency/);
    });
});
