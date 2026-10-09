/* eslint-disable no-console -- the JSON report on stdout is the output. */
/**
 * Plain Node, the built renderer through its `exports` map: loads `createRenderer` only (`esm` or `cjs`, argv[2]) and
 * reports every module file Node loaded for it, through an ESM resolve hook and the CommonJS module cache. An optional
 * argv[3] names one more package to load the same way: the negative control showing that a load is detected.
 */
import { appendFileSync, readFileSync, rmSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2];
const log = join(tmpdir(), `factory-only-${process.pid}.log`);
const hooks = `
import { appendFileSync } from 'node:fs';
export async function resolve(specifier, context, next)
{
    const result = await next(specifier, context);
    appendFileSync(${JSON.stringify(log)}, result.url + '\\n');
    return result;
}`;

appendFileSync(log, '');
register(`data:text/javascript,${encodeURIComponent(hooks)}`);

const require = createRequire(import.meta.url);
const before = new Set(Object.keys(require.cache));
let createRenderer;

if (mode === 'esm')
{
    ({ createRenderer } = await import('@pixi-react-provisional/renderer'));
}
else
{
    ({ createRenderer } = require('@pixi-react-provisional/renderer'));
}

const extra = process.argv[3];

if (extra)
{
    await (mode === 'esm' ? import(extra) : Promise.resolve(require(extra)));
}

const files = [
    ...readFileSync(log, 'utf8').split('\n').filter((url) => url.startsWith('file:')).map((url) => fileURLToPath(url)),
    ...Object.keys(require.cache).filter((file) => !before.has(file)),
];

rmSync(log, { force: true });

/** `@scope/name` or `name` of the package a file belongs to (workspace packages by their directory). */
function packageOf(file)
{
    const match = (/[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)[\\/](?!.*[\\/]node_modules[\\/])/).exec(file)
        ?? (/[\\/]packages[\\/]([^\\/]+)[\\/](?!.*[\\/]packages[\\/])/).exec(file);

    return match ? match[1].replace('\\', '/') : file;
}

console.log(JSON.stringify({
    mode,
    createRenderer: typeof createRenderer,
    packages: [...new Set(files.map(packageOf))].sort(),
    files: [...new Set(files)].length,
}));
