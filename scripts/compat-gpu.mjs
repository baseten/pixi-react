#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * One command for a hardware (real-GPU) verification run of the compatibility matrix, the same on macOS and in Windows
 * PowerShell (design/compatibility/cells/README.md, "Running on a real GPU"):
 *
 *   pnpm compat:gpu                      # macOS: the Chromium pinned by Playwright
 *   pnpm compat:gpu --browser chrome     # Windows: the installed Chrome (or msedge)
 *
 * Checks the Node version (package.json engines.node, .nvmrc) and the working tree, installs and builds the workspace,
 * installs the pinned Chromium, packs the artifacts into <work>/tarballs, runs every nightly cell (`--patches all --gpu
 * hardware --no-cache`), the boundary probes and the incompatible pairs, and builds the verification record with the
 * machine slug, the UTC date, the full commit and the tarballs. A failing cell, probe or negative case never stops the
 * run (failures are data); a setup error (install, build, pack, no result at all, the record build) does.
 *
 * Options:
 *   --browser chromium|chrome|msedge   the browser (default chromium; Windows needs chrome or msedge for WebGPU)
 *   --work DIR                          work directory (default .compat/gpu/full), wiped at start
 *   --machine SLUG                      override the detected machine slug
 *   --targeted                          only the 20 WebGPU-shim cells (React 18.3.1 and 19.3.0); a partial record
 *   --no-build                          skip `pnpm install --frozen-lockfile` and `pnpm build`
 *   --allow-dirty                       run although tracked files have uncommitted changes
 *   --push                              commit the record on a new branch records/<slug>-<date> and push it
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, lstatSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { cpus, release } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRequiredNode, BROWSERS, nodeRequirement, platformCommand } from '../design/compatibility/cells/matrix.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const RUN_CELLS = join('design', 'compatibility', 'cells', 'run-cells.mjs');
const VERIFICATION = join('design', 'compatibility', 'verification.mjs');
/** The targeted subset: the WebGPU versions the environment shim covers plus 8.10.2 and 8.22.0, at two React versions. */

export const TARGETED = { react: '18.3.1,19.3.0', pixi: '8.2.6,8.3.4,8.4.1,8.5.2,8.6.6,8.7.3,8.8.1,8.9.2,8.10.2,8.22.0' };

export function parseArguments(argv)
{
    const options = { browser: 'chromium', work: join('.compat', 'gpu', 'full'), machine: null, targeted: false, push: false, build: true, allowDirty: false, help: false };
    const flags = { '--targeted': 'targeted', '--push': 'push', '--allow-dirty': 'allowDirty', '--help': 'help', '-h': 'help' };

    for (let index = 0; index < argv.length; index++)
    {
        const arg = argv[index];

        if (arg === '--') continue;
        if (flags[arg]) options[flags[arg]] = true;
        else if (arg === '--no-build') options.build = false;
        else if (['--browser', '--work', '--machine'].includes(arg))
        {
            const value = argv[++index];

            assert.ok(value && !value.startsWith('--'), `${arg} needs a value`);
            options[arg.slice(2)] = value;
        }
        else assert.fail(`unknown argument ${arg} (see the top of scripts/compat-gpu.mjs)`);
    }
    assert.ok(BROWSERS[options.browser], `unknown --browser ${options.browser} (${Object.keys(BROWSERS).join(', ')})`);
    if (options.machine) assert.match(options.machine, /^[a-z0-9]+(-[a-z0-9]+)*$/, '--machine is lowercase words joined by hyphens');

    return options;
}

/** Lowercase words joined by hyphens. */
export const slugify = (text) => String(text).toLowerCase().replace(/\((r|tm)\)/g, '').replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** The macOS major version from Darwin's kernel release when `sw_vers` is unavailable (Darwin 25 is macOS 26). */
export const macosMajorFromDarwin = (darwin) => (darwin >= 25 ? darwin + 1 : darwin - 9);

/**
 * The machine slug of a record: `macos-<major>-<cpu>` on macOS, `windows-<build>-<gpu>` on Windows, plus `-<browser>`
 * when the browser is not the pinned Chromium. Linux has no hardware profile.
 */
export function machineSlug({ platform, macosMajor, cpu, windowsBuild, gpu, browser = 'chromium' })
{
    let slug;

    if (platform === 'darwin') slug = `macos-${macosMajor}-${slugify(cpu)}`;
    else if (platform === 'win32') slug = `windows-${windowsBuild}-${slugify(gpu || 'unknown-gpu')}`;
    else assert.fail(`the hardware profile runs on macOS and Windows only, not ${platform}`);

    return browser === 'chromium' ? slug : `${slug}-${browser}`;
}

/** The first real GPU of a Windows machine (not a basic, remote or virtual display adapter). */
export const firstGpu = (names) => names.map((name) => name.trim()).find((name) => name && !(/Basic|Remote|Virtual|Parsec/i).test(name)) ?? null;

function detectMachine(browser)
{
    if (process.platform === 'darwin')
    {
        const swVers = spawnSync('sw_vers', ['-productVersion'], { encoding: 'utf8' });
        const macosMajor = swVers.status === 0 ? Number(swVers.stdout.trim().split('.')[0]) : macosMajorFromDarwin(Number(release().split('.')[0]));

        return machineSlug({ platform: 'darwin', macosMajor, cpu: cpus()[0]?.model ?? 'unknown-cpu', browser });
    }
    if (process.platform === 'win32')
    {
        const query = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'], { encoding: 'utf8' });

        return machineSlug({ platform: 'win32', windowsBuild: release().split('.')[2], gpu: firstGpu((query.stdout ?? '').split(/\r?\n/)), browser });
    }

    return machineSlug({ platform: process.platform, browser });
}

/**
 * The steps of a run, in order: what to spawn, and whether a failure stops the run (`fatal`) or is data. `node` is
 * the Node binary; package-manager commands go through `platformCommand` (.cmd shims on Windows).
 */
/**
 * The work directory is wiped at the start of a run, so it must be a dedicated output directory: strictly inside the
 * checkout, under a top-level `.compat*` directory (git- and ESLint-ignored). Anything else, such as `.`, `..`, the
 * checkout itself, an ancestor of it or a source directory, is refused before anything is removed. So is a path through a
 * symbolic link or junction below the checkout (a symlinked `.compat`, say): the check above is lexical, and the wipe
 * would follow the link out of the checkout.
 */
export function safeWorkDir(root, work)
{
    const resolvedRoot = resolve(root);
    const resolvedWork = resolve(resolvedRoot, work);
    const inside = relative(resolvedRoot, resolvedWork);
    const [first] = inside.split(/[\\/]/);

    if (!inside || inside.startsWith('..') || isAbsolute(inside) || !first.startsWith('.compat'))
    {
        throw new Error(`--work ${work} resolves to ${resolvedWork}, which is not a dedicated output directory: use a path under `
            + `the checkout's .compat directory (default .compat/gpu/full). It is wiped at the start of a run.`);
    }

    let path = resolvedRoot;

    for (const part of inside.split(/[\\/]/))
    {
        path = join(path, part);
        if (lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink())
        {
            throw new Error(`--work ${work} goes through the symbolic link ${path}, and the wipe at the start of a run would follow `
                + `it out of the checkout: use a real directory under the checkout's .compat directory.`);
        }
    }

    return resolvedWork;
}

export function planSteps(options, { slug, date, commit, platform = process.platform })
{
    const work = options.work;
    const tarballs = join(work, 'tarballs');
    const hardware = ['--gpu', 'hardware', '--browser', options.browser, '--no-cache', '--work', work, '--tarballs', tarballs];
    const steps = [];
    const pm = (label, args, extra = {}) => steps.push({ label, command: platformCommand('pnpm', args, platform), fatal: true, ...extra });
    const node = (label, args, extra = {}) => steps.push({ label, command: { file: 'node', args, shell: false }, fatal: true, ...extra });

    if (options.build)
    {
        pm('install the workspace', ['install', '--frozen-lockfile']);
        pm('build the workspace', ['build']);
    }
    if (options.browser === 'chromium') pm('install the pinned Chromium', ['--filter', './apps/examples', 'exec', 'playwright', 'install', 'chromium']);
    node('pack the artifacts', [RUN_CELLS, 'pack', '--out', tarballs]);
    if (options.targeted)
    {
        node('run the targeted cells', [RUN_CELLS, 'run', '--tier', 'nightly', '--patches', 'all', ...hardware, '--react', TARGETED.react, '--pixi', TARGETED.pixi], { fatal: false, needsResults: true });
    }
    else
    {
        node('run every nightly cell', [RUN_CELLS, 'run', '--tier', 'nightly', '--patches', 'all', ...hardware], { fatal: false, needsResults: true });
        node('run the boundary probes', [RUN_CELLS, 'probes', '--tier', 'nightly', '--work', work], { fatal: false });
        node('run the incompatible pairs', [RUN_CELLS, 'run', '--negative', ...hardware], { fatal: false });
    }
    node('build the verification record', [VERIFICATION, 'build', '--work', work, '--tarballs', tarballs, '--date', date, '--commit', commit, '--machine', slug, '--scope', options.targeted ? 'partial' : 'full']);

    return steps;
}

/** The git commands of `--push`: a new branch from HEAD, only the records directory, one commit, one push. */
export function pushCommands({ slug, date, recordId })
{
    const branch = `records/${slug}-${date}`;

    return [
        ['switch', '-c', branch],
        ['add', join('design', 'compatibility', 'verification')],
        ['commit', '-m', `Add the hardware verification record ${recordId} [skip ci]`],
        ['push', '-u', 'origin', branch],
    ];
}

const git = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

function runStep(step, results)
{
    console.log(`\n=== ${step.label}\n$ ${step.command.file} ${step.command.args.join(' ')}`);
    const file = step.command.file === 'node' ? process.execPath : step.command.file;
    const result = spawnSync(file, step.command.args, { cwd: root, stdio: 'inherit', shell: step.command.shell });
    const ok = result.status === 0 && !result.error;

    if (!ok && step.needsResults && !(existsSync(results) && readdirSync(results).some((name) => name.endsWith('.json') && !name.startsWith('probe-'))))
    {
        throw new Error(`${step.label} produced no result at all (exit ${result.status}${result.error ? `, ${result.error.message}` : ''}): a setup error, not a cell failure`);
    }
    if (!ok && step.fatal) throw new Error(`${step.label} failed (exit ${result.status}${result.error ? `, ${result.error.message}` : ''})`);

    return ok;
}

function summarize(results)
{
    const rows = existsSync(results) ? readdirSync(results).filter((name) => name.endsWith('.json')).map((name) => JSON.parse(readFileSync(join(results, name), 'utf8'))) : [];
    const cells = rows.filter((row) => row.kind === 'cell');
    const backends = {};

    for (const row of cells)
    {
        for (const [name, backend] of Object.entries(row.backends ?? {}))
        {
            backends[name] ??= { pass: 0, fail: 0 };
            backends[name][backend.status === 'pass' ? 'pass' : 'fail']++;
        }
    }

    return {
        cells: cells.length,
        cellsFailed: cells.filter((row) => row.status === 'fail').map((row) => row.id),
        backends,
        probes: rows.filter((row) => row.kind === 'probe'),
        negatives: rows.filter((row) => row.kind === 'negative'),
    };
}

function main()
{
    const options = parseArguments(process.argv.slice(2));

    if (options.help)
    {
        const lines = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');

        console.log(lines.slice(3, lines.indexOf(' */')).map((line) => line.replace(/^ \* ?/, '')).join('\n'));

        return;
    }
    try
    {
        assertRequiredNode();
    }
    catch
    {
        const { range, nvmrc } = nodeRequirement();

        console.error(`This run needs Node ${nvmrc} (package.json engines.node "${range}", .nvmrc); this is Node ${process.versions.node}.\nSwitch with \`nvm use ${nvmrc}\` or \`fnm use ${nvmrc}\`, check that \`node --version\` prints v${nvmrc}, and run again.`);
        process.exitCode = 1;

        return;
    }
    const commit = git(['rev-parse', 'HEAD']).stdout.trim();

    assert.match(commit, /^[0-9a-f]{40}$/, 'not a git checkout');
    const changed = git(['status', '--porcelain', '--untracked-files=no']).stdout.trim();

    console.log(`Commit ${commit} (compare all 40 characters with the commit you were asked to run)`);
    if (changed && !options.allowDirty)
    {
        console.error(`Tracked files have uncommitted changes, so the record would not describe this commit:\n${changed}\nCommit or stash them (or pass --allow-dirty).`);
        process.exitCode = 1;

        return;
    }
    // The hardware profile runs on macOS and Windows only, whatever --machine says.
    assert.ok(['darwin', 'win32'].includes(process.platform), `the hardware profile runs on macOS and Windows only, not ${process.platform}`);
    const slug = options.machine ?? detectMachine(options.browser);
    const date = new Date().toISOString().slice(0, 10);
    const work = safeWorkDir(root, options.work);
    const results = join(work, 'results');
    const recordId = `${date}-${slug}`;

    console.log(`Machine ${slug}, date ${date} (UTC), browser ${options.browser}${BROWSERS[options.browser].pinned ? ' (pinned by Playwright)' : ' (installed)'}, work ${relative(root, work) || '.'}${options.targeted ? ', targeted subset (partial record)' : ''}`);
    if (process.platform === 'darwin')
    {
        // Keep the Mac awake for as long as this process runs.
        const awake = spawn('caffeinate', ['-dimsu', '-w', String(process.pid)], { stdio: 'ignore', detached: true });

        awake.on('error', () => console.log('(caffeinate is not available: keep the Mac awake yourself)'));
        awake.unref();
    }
    if (process.platform === 'win32') console.log('Reminder: set Sleep to "Never" (Settings > System > Power) for the next hours; a sleeping PC stops the run.');
    rmSync(work, { recursive: true, force: true });
    const steps = planSteps({ ...options, work }, { slug, date, commit });
    const outcomes = [];

    for (const step of steps) outcomes.push([step.label, runStep(step, results)]);
    const summary = summarize(results);
    const record = join('design', 'compatibility', 'verification', `${recordId}.json`);

    console.log(`\n=== Summary\n${summary.cells} cells, ${summary.cellsFailed.length} failed${summary.cellsFailed.length ? `: ${summary.cellsFailed.join(', ')}` : ''}`);
    for (const [name, counts] of Object.entries(summary.backends)) console.log(`  ${name}: ${counts.pass} passed, ${counts.fail} failed`);
    if (!options.targeted)
    {
        console.log(`${summary.probes.filter((row) => row.status !== 'fail').length} of ${summary.probes.length} boundary probes as expected, ${summary.negatives.filter((row) => row.status === 'expected-fail').length} of ${summary.negatives.length} incompatible pairs rejected as expected`);
    }
    for (const [label, ok] of outcomes) if (!ok) console.log(`  step with failures (recorded as data): ${label}`);
    console.log(`Record: ${record} and .md; diagnostics: ${relative(root, join(work, 'out'))}`);
    if (options.push)
    {
        for (const args of pushCommands({ slug, date, recordId }))
        {
            console.log(`$ git ${args.join(' ')}`);
            const result = spawnSync('git', args, { cwd: root, stdio: 'inherit' });

            if (result.status !== 0) throw new Error(`git ${args[0]} failed; the record is in ${record}`);
        }
    }
    else console.log('Send the record back: commit only design/compatibility/verification/ (or rerun with --push).');
    process.exitCode = summary.cellsFailed.length || outcomes.some(([, ok]) => !ok) ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
{
    try
    {
        main();
    }
    catch (error)
    {
        console.error(`\ncompat:gpu stopped: ${error.message}`);
        process.exitCode = 1;
    }
}
