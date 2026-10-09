#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Declaration consumer checks for the built renderer and core packages.
 *
 * 1. Compiles `test-d` as an installed consumer would see the packages (their `exports` and emitted declarations),
 *    under NodeNext (`.mts` through `import`, `.cts` through `require`) and under Bundler resolution.
 * 2. Proves every `@ts-expect-error` directive is load-bearing: for each one, the file is recompiled with that
 *    directive removed, and the check fails unless the compiler then reports an error on the line it guarded.
 *
 * Run from the renderer package after `build`.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(packageDir, 'package.json'));
const ts = require('typescript');

function load(configPath)
{
    const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: (d) => { throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n')); } });

    return parsed;
}

function format(diagnostics)
{
    return ts.formatDiagnostics(diagnostics, {
        getCanonicalFileName: (name) => name,
        getCurrentDirectory: () => packageDir,
        getNewLine: () => '\n',
    });
}

let failed = false;
const configs = ['test-d/tsconfig.json', 'test-d/tsconfig.bundler.json'];
let baseline;

for (const config of configs)
{
    const parsed = load(join(packageDir, config));
    const program = ts.createProgram(parsed.fileNames, parsed.options);
    const diagnostics = ts.getPreEmitDiagnostics(program);

    if (diagnostics.length)
    {
        failed = true;
        console.error(`${config}: ${diagnostics.length} error(s)\n${format(diagnostics)}`);
    }
    else
    {
        console.log(`${config}: ${parsed.fileNames.length} consumer files compile`);
    }

    baseline ??= { parsed, program };
}

// Sensitivity of each @ts-expect-error, against the NodeNext program (which includes every test-d file).
const { parsed, program } = baseline;
const directive = /\/\/\s*@ts-expect-error\b.*$/;
let checked = 0;

for (const fileName of parsed.fileNames)
{
    const lines = readFileSync(fileName, 'utf8').split('\n');

    for (const [index, line] of lines.entries())
    {
        if (!directive.test(line))
        {
            continue;
        }

        const modified = [...lines];

        modified[index] = line.replace(directive, '// (directive removed)');

        const text = modified.join('\n');
        const host = ts.createCompilerHost(parsed.options);
        const getSourceFile = host.getSourceFile.bind(host);

        host.getSourceFile = (name, languageVersion, onError, shouldCreate) => (
            resolve(name) === resolve(fileName)
                ? ts.createSourceFile(name, text, languageVersion, true)
                : getSourceFile(name, languageVersion, onError, shouldCreate)
        );

        const variant = ts.createProgram(parsed.fileNames, parsed.options, host, program);
        const source = variant.getSourceFile(fileName);
        const guarded = index + 1;
        const errors = ts.getPreEmitDiagnostics(variant, source).filter((diagnostic) =>
            diagnostic.file && diagnostic.start !== undefined
            && diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line === guarded);

        checked += 1;

        if (!errors.length)
        {
            failed = true;
            console.error(`${fileName}:${index + 1}: removing this @ts-expect-error leaves line ${guarded + 1} compiling; the assertion is not load-bearing`);
        }
    }
}

console.log(`${checked} @ts-expect-error directives checked: each one fails when removed`);

if (failed)
{
    process.exit(1);
}
