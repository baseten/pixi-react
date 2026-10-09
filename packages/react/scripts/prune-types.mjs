#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Removes the internal declarations that name the modular adapter packages, after `tsc` has emitted one declaration
 * per source file.
 *
 * The facade bundles its adapters, so its published declarations must not import the unpublished modular adapter
 * packages. Only internal modules (`bind`, `adapters`, `runtime/composition`, `runtime/sceneAdapter`) name them, and
 * the public entry (`types/index.d.ts`) reaches none of them. Such a declaration is removed when the entry does not
 * reach it, together with the internal declarations that import a removed one (the facade's internal factories), so
 * no shipped declaration imports a missing file. The build fails if the entry reaches any of them.
 */
import { readdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';

const PROVISIONAL_SCOPE = '@pixi-react-provisional/';
const packageDir = process.cwd();
const typesDir = join(packageDir, 'types');
const ts = createRequire(join(packageDir, 'package.json'))('typescript');

const program = ts.createProgram([join(typesDir, 'index.d.ts')], {
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    target: ts.ScriptTarget.ESNext,
    jsx: ts.JsxEmit.ReactJSX,
    noEmit: true,
    skipLibCheck: true,
    types: [],
});
const reached = new Set(program.getSourceFiles().map((file) => file.fileName).filter((file) => file.startsWith(`${typesDir}/`)));
const all = readdirSync(typesDir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.d.ts'))
    .map((entry) => join(entry.parentPath, entry.name));

/** The declaration files under `types/` that `file` imports through a relative specifier. */
function localImports(file)
{
    const specifiers = [...readFileSync(file, 'utf8').matchAll(/(?:from\s+|import\()['"](\.{1,2}\/[^'"]+)['"]/g)].map((match) => match[1]);

    return specifiers.map((specifier) => join(dirname(file), specifier))
        .flatMap((base) => [`${base}.d.ts`, join(base, 'index.d.ts')])
        .filter((candidate) => all.includes(candidate));
}

const removed = new Set(all.filter((file) => readFileSync(file, 'utf8').includes(PROVISIONAL_SCOPE)));

for (let grew = true; grew;)
{
    grew = false;
    for (const file of all)
    {
        if (!removed.has(file) && localImports(file).some((imported) => removed.has(imported)))
        {
            removed.add(file);
            grew = true;
        }
    }
}

const leaking = [...removed].filter((file) => reached.has(file)).map((file) => relative(packageDir, file));

if (leaking.length)
{
    throw new Error(`Public declarations reference ${PROVISIONAL_SCOPE}*: ${leaking.join(', ')}`);
}

for (const file of removed)
{
    rmSync(file);
    if (!readdirSync(dirname(file)).length) rmSync(dirname(file), { recursive: true });
}

console.log(`${packageDir}: removed ${removed.size} internal declarations (${[...removed].map((file) => relative(packageDir, file)).sort().join(', ')})`);
