#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Inspects the BUILT runtime and declaration dependency graph of a package and fails when it reaches anything
 * outside an allowlist. It reads every emitted file (.js/.cjs/.mjs and .d.ts/.d.mts/.d.cts), extracts static
 * imports, re-exports, `require()` calls, dynamic `import()`, `import("…")` types and triple-slash
 * references with the TypeScript scanner, and checks each specifier:
 *
 *   - relative specifiers must stay inside the package's dist directory;
 *   - bare specifiers must be in `--allow` (core allows none; renderer allows only core);
 *   - triple-slash `types`/`lib` references are reported like bare specifiers.
 *
 * It also checks that package.json declares no runtime or peer dependency outside the allowlist.
 *
 * Usage (from a package directory): node ../../scripts/check-dependency-graph.mjs [--allow name]... [--dist dir]
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve, sep } from 'node:path';

const args = process.argv.slice(2);
const allow = new Set();
let distArg = 'dist';
let packageDir = process.cwd();

for (let i = 0; i < args.length; i++)
{
    if (args[i] === '--allow')
    {
        allow.add(args[++i]);
    }
    else if (args[i] === '--dist')
    {
        distArg = args[++i];
    }
    else if (args[i] === '--package')
    {
        packageDir = resolve(args[++i]);
    }
    else
    {
        throw new Error(`Unknown argument ${args[i]}`);
    }
}

const require = createRequire(join(process.cwd(), 'package.json'));
const ts = require('typescript');

const dist = resolve(packageDir, distArg);

if (!existsSync(dist))
{
    console.error(`No build output at ${dist}; run the build first.`);
    process.exit(1);
}

const EMITTED = /\.(c|m)?js$|\.d\.(c|m)?ts$/;
const FORBIDDEN_LITERAL = /["'`](?:react|react-dom|react-reconciler|scheduler|its-fine|pixi\.js|@pixi\/[\w.-]+)(?:\/[^"'`]*)?["'`]/g;

function walk(dir)
{
    return readdirSync(dir).flatMap((name) =>
    {
        const path = join(dir, name);

        if (statSync(path).isDirectory())
        {
            return walk(path);
        }

        return EMITTED.test(name) ? [path] : [];
    });
}

/** Every module specifier a file references, with its kind. */
function specifiersOf(file)
{
    const text = readFileSync(file, 'utf8');
    const info = ts.preProcessFile(text, true, true);
    const found = info.importedFiles.map((ref) => ({ kind: 'import', specifier: ref.fileName }));

    for (const ref of info.typeReferenceDirectives)
    {
        found.push({ kind: 'reference types', specifier: ref.fileName });
    }

    for (const ref of info.libReferenceDirectives)
    {
        found.push({ kind: 'reference lib', specifier: `lib:${ref.fileName}` });
    }

    for (const ref of info.referencedFiles)
    {
        found.push({ kind: 'reference path', specifier: ref.fileName });
    }

    return found;
}

function packageNameOf(specifier)
{
    const parts = specifier.split('/');

    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const violations = [];
const graph = {};

for (const file of walk(dist))
{
    const name = relative(packageDir, file);

    graph[name] = [];

    for (const { kind, specifier } of specifiersOf(file))
    {
        graph[name].push(specifier);

        if (kind === 'reference lib')
        {
            continue;
        }

        if (specifier.startsWith('.'))
        {
            const target = resolve(dirname(file), specifier);

            if (target !== dist && !target.startsWith(dist + sep))
            {
                violations.push(`${name}: ${kind} "${specifier}" leaves the package build output`);
            }

            continue;
        }

        if (!allow.has(packageNameOf(specifier)))
        {
            violations.push(`${name}: ${kind} "${specifier}" is not an allowed dependency`);
        }
    }

    // Belt and braces: a quoted framework/scene package name anywhere (e.g. a computed require) also fails.
    for (const match of readFileSync(file, 'utf8').matchAll(FORBIDDEN_LITERAL))
    {
        violations.push(`${name}: mentions forbidden module ${match[0]}`);
    }
}

const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'));

for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'])
{
    for (const dependency of Object.keys(manifest[field] ?? {}))
    {
        if (!allow.has(dependency))
        {
            violations.push(`package.json: ${field} declares "${dependency}", which is not allowed`);
        }
    }
}

const files = Object.keys(graph).length;

console.log(`${manifest.name}: ${files} built files; allowed external dependencies: ${[...allow].join(', ') || 'none'}`);

for (const [file, specifiers] of Object.entries(graph))
{
    const external = specifiers.filter((specifier) => !specifier.startsWith('.'));

    if (external.length)
    {
        console.log(`  ${file} -> ${external.join(', ')}`);
    }
}

if (files === 0)
{
    violations.push('no built files found');
}

if (violations.length)
{
    console.error(`Dependency graph check failed:\n  ${violations.join('\n  ')}`);
    process.exit(1);
}

console.log('Dependency graph check passed.');
