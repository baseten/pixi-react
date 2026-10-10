/**
 * Keeps the example set consistent (issue 18): catalog.json, the app's routes, the docs registry and the sources.
 * Offline and browser-free; the browser tests are the Playwright suite in e2e/ (README.md, "Browser tests").
 */
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { stripHarness } from '../src/harness/strip.js';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const examplesDir = join(appRoot, 'src/examples');
const docsRegistry = join(appRoot, '../docs/src/components/LocalExample/registry.ts');
const { examples } = JSON.parse(readFileSync(join(appRoot, 'src/catalog.json'), 'utf8'));
const read = (file) => readFileSync(join(examplesDir, file), 'utf8');

function walk(dir)
{
    return readdirSync(dir).flatMap((entry) => (statSync(join(dir, entry)).isDirectory() ? walk(join(dir, entry)) : [join(dir, entry)]));
}

test('catalog entries are unique and complete', () =>
{
    const ids = examples.map((example) => example.id);

    assert.equal(new Set(ids).size, ids.length, 'unique ids');
    for (const example of examples)
    {
        assert.match(example.id, /^[a-z0-9-]+$/, `${example.id}: a URL-safe id`);
        for (const key of ['title', 'summary', 'composition', 'files', 'docs', 'fixtures']) assert.ok(key in example, `${example.id}: ${key}`);
        assert.ok(['facade', 'createRenderer'].includes(example.composition), `${example.id}: composition`);
        for (const file of example.files) assert.ok(existsSync(join(examplesDir, file)), `${example.id}: ${file} exists`);
    }
    assert.ok(examples.some((example) => example.composition === 'createRenderer'), 'at least one createRenderer route');
});

test('every example source belongs to exactly one catalog entry', () =>
{
    const listed = examples.flatMap((example) => example.files).sort();
    const found = walk(examplesDir).map((file) => relative(examplesDir, file).split('\\').join('/')).sort();

    assert.deepEqual(found, listed);
});

test('every catalog entry has a route', () =>
{
    const routes = readFileSync(join(appRoot, 'src/routes.tsx'), 'utf8');
    const keys = [...routes.matchAll(/^\s+'([a-z0-9-]+)': lazy\(\(\) => import\('\.\/examples\/([^']+)'\)\)/gm)];

    assert.deepEqual(keys.map(([, id]) => id).sort(), examples.map((example) => example.id).sort());
    for (const [, id, path] of keys)
    {
        const entry = examples.find((example) => example.id === id);

        assert.ok(entry.files.some((file) => file.replace(/\.tsx?$/, '') === path), `${id}: the route loads one of its files`);
    }
});

test('examples are deterministic and local: no remote URLs, clocks or randomness', () =>
{
    for (const file of examples.flatMap((example) => example.files))
    {
        const source = read(file);

        assert.doesNotMatch(source, /https?:\/\//, `${file}: no remote URL`);
        assert.doesNotMatch(source, /Math\.random|crypto\.getRandomValues|Date\.now|performance\.now|new Date\(/, `${file}: no randomness or wall clock`);
    }
});

test('every route reports its scene to the harness, and the docs copy shows none of it', () =>
{
    for (const example of examples)
    {
        const sources = example.files.map(read);

        assert.ok(sources.some((source) => (/useExampleHarness\(\{/).test(source)), `${example.id}: a scene component reports (route readiness)`);
        for (const [index, source] of sources.entries())
        {
            for (const line of source.split('\n').filter((item) => (/harness/i).test(item)))
            {
                assert.match(line, /\/\/ @harness$/, `${example.files[index]}: harness line not marked "// @harness": ${line.trim()}`);
            }
            const stripped = stripHarness(source);

            assert.doesNotMatch(stripped, /harness/i, `${example.files[index]}: the docs copy mentions the harness`);
            assert.doesNotMatch(stripped, /\n[ \t]*\n[ \t]*\n/, `${example.files[index]}: the docs copy has no double blank line`);
            assert.doesNotMatch(stripped, /[{(]\n[ \t]*\n/, `${example.files[index]}: the docs copy opens no block with a blank line`);
        }
    }
});

test('the docs registry embeds exactly the docs examples, from these files', () =>
{
    const registry = readFileSync(docsRegistry, 'utf8');
    const raw = [...registry.matchAll(/'!!raw-loader!@pixi-react-provisional\/examples\/src\/examples\/([^']+)'/g)].map(([, file]) => file).sort();
    const modules = [...registry.matchAll(/import\('@pixi-react-provisional\/examples\/src\/examples\/([^']+)'\)/g)].map(([, file]) => file).sort();
    const docs = examples.filter((example) => example.docs);

    assert.deepEqual(raw, docs.flatMap((example) => example.files).sort(), 'raw sources');
    assert.deepEqual(modules, docs.map((example) => example.files[0]).sort(), 'live previews (each loads its first file)');
    for (const example of docs) assert.match(registry, new RegExp(`'${example.id}':`), `${example.id}: a registry entry`);
});
