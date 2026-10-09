#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * TypeScript consumer fixtures for the published declarations (issue 11).
 *
 * 1. Packs the built workspace packages (`pnpm pack`), as they would be published.
 * 2. For each cell of the matrix (a React type line x a pixi.js version) creates a consumer OUTSIDE the repository
 *    (`$PIXI_REACT_TYPE_CELLS`, default `<os tmpdir>/pixi-react-type-consumers`) and installs the tarballs plus the
 *    cell's exact React, @types/react, pixi.js and TypeScript from the registry with `pnpm install --ignore-workspace`.
 *    Nothing resolves through a workspace link or a tsconfig path alias, and no parent `node_modules` is reachable.
 * 3. Compiles every fixture program of the cell under NodeNext and Bundler resolution and classic (`react`),
 *    automatic (`react-jsx`) and development (`react-jsxdev`) JSX, with `skipLibCheck: false`, so the packed
 *    declarations themselves are checked too.
 * 4. Proves each `@ts-expect-error` is load-bearing: the file is recompiled with that one directive removed, and the
 *    run fails unless the compiler then reports an error on the line it guarded.
 * 5. Compiles each must-fail program (fixtures/must-fail) and requires the diagnostic codes it names: these document
 *    limits, such as two global declarations of one JSX tag in one program.
 *
 * Usage: node scripts/run.mjs [--cell <name>]... [--skip-install]
 */
import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoDir = resolve(packageDir, '../..');
const fixturesDir = join(packageDir, 'fixtures');
const cellsRoot = resolve(process.env.PIXI_REACT_TYPE_CELLS ?? join(tmpdir(), 'pixi-react-type-consumers'));

const args = process.argv.slice(2);
const onlyCells = args.flatMap((arg, index) => (args[index - 1] === '--cell' ? [arg] : []));
const skipInstall = args.includes('--skip-install');

/**
 * The compiler of each pixi.js version. 8.2.6 needs the audit's 5.6.3 under `skipLibCheck: false` (5.7's DOM
 * PointerEvent adds members Pixi 8.2.6's declarations lack; design/contract/README.md); 8.22.0's declarations use
 * 5.7's generic typed arrays (`Float32Array<ArrayBuffer>`).
 */
const TYPESCRIPT = { '8.2.6': '5.6.3', '8.22.0': '5.7.3' };

/**
 * Errors inside third-party declarations that a strict consumer (`skipLibCheck: false`) cannot avoid. They are
 * reported, never counted as failures; any other error, and every error in this repository's packages or the
 * fixtures, fails the run. Each entry names the package, the codes and why.
 */
const THIRD_PARTY_DEFECTS = [
    {
        package: 'pixi.js',
        versions: ['8.22.0'],
        codes: [1479, 1542],
        reason: 'pixi.js 8.22.0 ships CommonJS-format .d.ts files that import the ESM-only earcut and tiny-lru (NodeNext)',
    },
];

/** Workspace packages, packed. `key` names them in the cell definitions. */
const WORKSPACE = {
    core: { dir: 'packages/core', name: '@pixi-react-provisional/core' },
    renderer: { dir: 'packages/renderer', name: '@pixi-react-provisional/renderer' },
    react19: { dir: 'packages/react-19', name: '@pixi-react-provisional/react-19' },
    pixi8: { dir: 'packages/pixi-8', name: '@pixi-react-provisional/pixi-8' },
    facade: { dir: 'packages/react', name: '@pixi/react' },
};

/** React type lines. Each lists the workspace packages its consumer installs and the fixture programs it compiles. */
const REACT = {
    19: {
        registry: {
            react: '19.3.0',
            'react-dom': '19.3.0',
            '@types/react': '19.3.0',
            '@types/react-dom': '19.3.0',
            // The facade's `Root.fiber` declaration imports react-reconciler, which ships no types (as upstream).
            '@types/react-reconciler': '0.28.9',
        },
        workspace: ['core', 'renderer', 'react19', 'pixi8', 'facade'],
        programs: ['react-19', 'facade'],
    },
    // Types only: the React 18 runtime adapter is issue 12's. The consumer installs no React 19 package.
    18: {
        registry: { react: '18.3.1', 'react-dom': '18.3.1', '@types/react': '18.3.31', '@types/react-dom': '18.3.7' },
        workspace: ['core', 'pixi8'],
        programs: ['react-18'],
    },
};

/** The peer range's floor and newest certified version (pixi-8 README). */
const PIXI = Object.keys(TYPESCRIPT);

const CELLS = Object.keys(REACT).sort().reverse().flatMap((react) =>
    PIXI.map((pixi) => ({ name: `react-${react}-pixi-${pixi}`, react, pixi })));

const RESOLUTIONS = {
    NodeNext: { module: 'NodeNext', moduleResolution: 'NodeNext' },
    Bundler: { module: 'ESNext', moduleResolution: 'Bundler' },
};

const JSX_MODES = { classic: 'react', automatic: 'react-jsx', dev: 'react-jsxdev' };

function run(command, commandArgs, options)
{
    return execFileSync(command, commandArgs, { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', ...options });
}

/** The pnpm that runs this script (`npm_execpath`), else `pnpm` on the PATH. */
function pnpm(commandArgs, cwd)
{
    const execPath = process.env.npm_execpath;

    if (execPath && (/pnpm/).test(basename(execPath)) && (/\.c?js$/).test(execPath))
    {
        return run(process.execPath, [execPath, ...commandArgs], { cwd });
    }

    return run('pnpm', commandArgs, { cwd, shell: process.platform === 'win32' });
}

function packWorkspace(tarballDir)
{
    rmSync(tarballDir, { recursive: true, force: true });
    mkdirSync(tarballDir, { recursive: true });

    const tarballs = {};

    for (const [key, { dir, name }] of Object.entries(WORKSPACE))
    {
        const out = join(tarballDir, key);

        mkdirSync(out);
        pnpm(['pack', '--pack-destination', out], join(repoDir, dir));

        const [file] = readdirSync(out).filter((entry) => entry.endsWith('.tgz'));

        if (!file)
        {
            throw new Error(`pnpm pack produced no tarball for ${name}`);
        }

        tarballs[key] = join(out, file);
    }

    return tarballs;
}

/** Files of a fixture directory for one pixi version: shared files plus the `*.pixi-<version>.*` files of that version. */
function programFiles(dir, pixi)
{
    return readdirSync(dir).filter((file) =>
    {
        const version = (/\.pixi-(\d+\.\d+\.\d+)\./).exec(file)?.[1];

        return (/\.(tsx?|cts|mts)$/).test(file) && (!version || version === pixi);
    }).sort();
}

function installCell(cell, tarballs)
{
    const dir = join(cellsRoot, cell.name);
    const react = REACT[cell.react];
    const overrides = Object.fromEntries(react.workspace.map((key) => [WORKSPACE[key].name, `file:${tarballs[key]}`]));
    const manifest = {
        name: `type-consumer-${cell.name}`,
        version: '0.0.0',
        private: true,
        type: 'module',
        dependencies: {
            ...overrides,
            ...react.registry,
            'pixi.js': cell.pixi,
            typescript: TYPESCRIPT[cell.pixi],
        },
        pnpm: { overrides },
    };

    if (!skipInstall)
    {
        rmSync(dir, { recursive: true, force: true });
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
        // Keep the consumer self-contained: no hoisting into a parent, no peers fetched implicitly.
        writeFileSync(join(dir, '.npmrc'), 'auto-install-peers=false\nstrict-peer-dependencies=false\n');
        pnpm(['install', '--ignore-workspace', '--no-frozen-lockfile', '--reporter', 'append-only'], dir);
    }

    return dir;
}

function versionsOf(dir)
{
    const read = (name) => JSON.parse(readFileSync(join(dir, 'node_modules', name, 'package.json'), 'utf8')).version;

    return ['typescript', 'react', '@types/react', 'pixi.js'].map((name) => `${name}@${read(name)}`).join(', ');
}

/** Copies a program's files into the cell and returns the absolute file names. */
function stageProgram(cellDir, program, pixi, source = join(fixturesDir, program))
{
    const target = join(cellDir, 'src', program);

    rmSync(target, { recursive: true, force: true });
    mkdirSync(target, { recursive: true });

    return programFiles(source, pixi).map((file) =>
    {
        cpSync(join(source, file), join(target, file));

        return join(target, file);
    });
}

function compilerOptions(ts, cellDir, resolution, jsx)
{
    const json = {
        compilerOptions: {
            target: 'ES2022',
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
            strict: true,
            noEmit: true,
            skipLibCheck: false,
            types: [],
            jsx: JSX_MODES[jsx],
            ...RESOLUTIONS[resolution],
        },
    };
    const parsed = ts.parseJsonConfigFileContent(json, ts.sys, cellDir);

    if (parsed.errors.length)
    {
        throw new Error(ts.formatDiagnostics(parsed.errors, formatHost(cellDir)));
    }

    return parsed.options;
}

/** The installed package (name and version) a diagnostic's file belongs to, or null for the consumer's own files. */
function packageOf(fileName)
{
    const match = (/[\\/]node_modules[\\/]\.pnpm[\\/]((?:@[^+]+\+)?[^@]+)@([^_/\\]+)/).exec(fileName ?? '');

    return match ? { name: match[1].replace('+', '/'), version: match[2] } : null;
}

const tolerated = new Map();

/** Drops (and records) the diagnostics that THIRD_PARTY_DEFECTS lists; returns the rest. */
function significant(diagnostics, label)
{
    return diagnostics.filter((diagnostic) =>
    {
        const owner = packageOf(diagnostic.file?.fileName);
        const defect = owner && THIRD_PARTY_DEFECTS.find((entry) => entry.package === owner.name
            && entry.versions.includes(owner.version) && entry.codes.includes(diagnostic.code));

        if (defect)
        {
            const key = `${defect.package}@${owner.version} TS${diagnostic.code}: ${defect.reason}`;

            tolerated.set(key, (tolerated.get(key) ?? new Set()).add(label));
        }

        return !defect;
    });
}

function formatHost(cwd)
{
    return { getCanonicalFileName: (name) => name, getCurrentDirectory: () => cwd, getNewLine: () => '\n' };
}

const failures = [];
let compiled = 0;
let directives = 0;

function compileVariants(ts, cell, cellDir, program, files)
{
    let reference;

    for (const resolution of Object.keys(RESOLUTIONS))
    {
        for (const jsx of Object.keys(JSX_MODES))
        {
            // `import x = require()` is CommonJS-only: `.cts` consumers run under NodeNext.
            const roots = resolution === 'NodeNext' ? files : files.filter((file) => !file.endsWith('.cts'));
            const options = compilerOptions(ts, cellDir, resolution, jsx);
            const program_ = ts.createProgram(roots, options);
            const label = `${cell.name} ${program} ${resolution}/${jsx}`;
            const diagnostics = significant(ts.getPreEmitDiagnostics(program_), label);

            compiled += 1;

            if (diagnostics.length)
            {
                failures.push(`${label}: ${diagnostics.length} error(s)\n${ts.formatDiagnostics(diagnostics, formatHost(cellDir))}`);
            }
            else
            {
                console.log(`  ok  ${label} (${roots.length} files)`);
            }

            if (resolution === 'NodeNext' && jsx === 'automatic')
            {
                reference = { options, program: program_, roots };
            }
        }
    }

    return reference;
}

const DIRECTIVE = /\/\/\s*@ts-expect-error\b.*$/;

/** Every @ts-expect-error in the program's files must guard an error. */
function checkDirectives(ts, cell, program, { options, program: baseProgram, roots })
{
    let count = 0;

    for (const fileName of roots)
    {
        const lines = readFileSync(fileName, 'utf8').split('\n');

        for (const [index, line] of lines.entries())
        {
            if (!DIRECTIVE.test(line))
            {
                continue;
            }

            const modified = [...lines];

            modified[index] = line.replace(DIRECTIVE, '// (directive removed)');

            const text = modified.join('\n');
            const host = ts.createCompilerHost(options);
            const getSourceFile = host.getSourceFile.bind(host);

            host.getSourceFile = (name, languageVersion, onError, shouldCreate) => (
                resolve(name) === resolve(fileName)
                    ? ts.createSourceFile(name, text, languageVersion, true)
                    : getSourceFile(name, languageVersion, onError, shouldCreate)
            );

            const variant = ts.createProgram(roots, options, host, baseProgram);
            const source = variant.getSourceFile(fileName);
            const guarded = index + 1;
            const errors = ts.getPreEmitDiagnostics(variant, source).filter((diagnostic) =>
                diagnostic.file && diagnostic.start !== undefined
                && diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start).line === guarded);

            count += 1;

            if (!errors.length)
            {
                failures.push(`${cell.name} ${program} ${relative(join(cellsRoot, cell.name, 'src'), fileName)}:${index + 1}: removing this `
                    + `@ts-expect-error leaves line ${guarded + 1} compiling; the assertion is not load-bearing`);
            }
        }
    }

    directives += count;
    console.log(`  ok  ${cell.name} ${program}: ${count} @ts-expect-error directives each fail when removed`);
}

/** A must-fail program compiles with exactly the diagnostic codes its `expect.json` names, and at least one. */
function checkMustFail(ts, cell, cellDir)
{
    const root = join(fixturesDir, 'must-fail');

    for (const name of readdirSync(root).sort())
    {
        const caseDir = join(root, name);
        const expected = JSON.parse(readFileSync(join(caseDir, 'expect.json'), 'utf8'));

        if (!expected.react.includes(cell.react))
        {
            continue;
        }

        const files = stageProgram(cellDir, `must-fail-${name}`, cell.pixi, caseDir);
        const options = compilerOptions(ts, cellDir, 'NodeNext', 'automatic');
        const label = `${cell.name} must-fail/${name}`;
        const diagnostics = significant(ts.getPreEmitDiagnostics(ts.createProgram(files, options)), label);
        const codes = [...new Set(diagnostics.map((diagnostic) => diagnostic.code))].sort();

        compiled += 1;

        if (!codes.length || codes.some((code) => !expected.codes.includes(code)))
        {
            failures.push(`${label}: expected only TS${expected.codes.join(', TS')}, got `
                + `${codes.length ? `TS${codes.join(', TS')}` : 'no error'}\n${ts.formatDiagnostics(diagnostics, formatHost(cellDir))}`);
        }
        else
        {
            console.log(`  ok  ${label} fails as documented (TS${codes.join(', TS')}): ${expected.reason}`);
        }
    }
}

const selected = CELLS.filter((cell) => !onlyCells.length || onlyCells.includes(cell.name));

if (!selected.length)
{
    console.error(`No cell matches ${onlyCells.join(', ')}. Cells: ${CELLS.map((cell) => cell.name).join(', ')}`);
    process.exit(1);
}

console.log(`Type consumers in ${cellsRoot}`);

const tarballs = skipInstall ? null : packWorkspace(join(cellsRoot, 'tarballs'));

for (const cell of selected)
{
    const cellDir = installCell(cell, tarballs ?? {});

    if (!existsSync(join(cellDir, 'node_modules')))
    {
        throw new Error(`${cellDir} is not installed; run without --skip-install`);
    }

    console.log(`${cell.name}: ${versionsOf(cellDir)}`);

    const ts = createRequire(join(cellDir, 'package.json'))('typescript');

    for (const program of REACT[cell.react].programs)
    {
        const files = stageProgram(cellDir, program, cell.pixi);
        const reference = compileVariants(ts, cell, cellDir, program, files);

        checkDirectives(ts, cell, program, reference);
    }

    checkMustFail(ts, cell, cellDir);
}

for (const [defect, labels] of tolerated)
{
    console.log(`Tolerated third-party declaration error, in ${labels.size} program(s): ${defect}`);
}

console.log(`${compiled} programs compiled, ${directives} @ts-expect-error directives checked across ${selected.length} cells`);

if (failures.length)
{
    console.error(`\n${failures.length} failure(s):\n\n${failures.join('\n\n')}`);
    process.exit(1);
}
