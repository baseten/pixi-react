// Offline tests of scripts/compat-gpu.mjs (`pnpm compat:gpu`, the one-command hardware run): arguments, the machine
// slug and the steps it spawns. Nothing here runs a cell.
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { firstGpu, machineSlug, safeWorkDir, macosMajorFromDarwin, parseArguments, planSteps, pushCommands, slugify, TARGETED } from '../../../scripts/compat-gpu.mjs';

const context = { slug: 'macos-26-apple-m5-max', date: '2026-10-12', commit: 'a'.repeat(40), platform: 'darwin' };

test('compat:gpu arguments: defaults, --browser, --work, --machine, flags; unknown or empty values fail', () =>
{
    assert.deepEqual(parseArguments([]), { browser: 'chromium', work: join('.compat', 'gpu', 'full'), machine: null, targeted: false, push: false, build: true, allowDirty: false, help: false });
    const options = parseArguments(['--', '--browser', 'chrome', '--work', 'C:\\w', '--machine', 'windows-26200-x', '--targeted', '--push', '--no-build', '--allow-dirty']);

    assert.deepEqual(options, { browser: 'chrome', work: 'C:\\w', machine: 'windows-26200-x', targeted: true, push: true, build: false, allowDirty: true, help: false });
    assert.throws(() => parseArguments(['--browser', 'firefox']), /unknown --browser firefox/);
    assert.throws(() => parseArguments(['--browser']), /--browser needs a value/);
    assert.throws(() => parseArguments(['--work', '--push']), /--work needs a value/);
    assert.throws(() => parseArguments(['--machine', 'Mac Studio']), /lowercase words joined by hyphens/);
    assert.throws(() => parseArguments(['--gpu', 'software']), /unknown argument --gpu/);
});

test('compat:gpu machine slug: macOS major and CPU, Windows build and first real GPU, the browser when not chromium; no Linux', () =>
{
    assert.equal(slugify('NVIDIA GeForce RTX(TM) 4070 '), 'nvidia-geforce-rtx-4070');
    assert.equal(machineSlug({ platform: 'darwin', macosMajor: 26, cpu: 'Apple M5 Max' }), 'macos-26-apple-m5-max');
    assert.equal(machineSlug({ platform: 'darwin', macosMajor: 15, cpu: 'Apple M2', browser: 'chrome' }), 'macos-15-apple-m2-chrome');
    assert.equal(machineSlug({ platform: 'win32', windowsBuild: '26200', gpu: 'NVIDIA GeForce RTX 4070', browser: 'chrome' }), 'windows-26200-nvidia-geforce-rtx-4070-chrome');
    assert.equal(machineSlug({ platform: 'win32', windowsBuild: '26200', gpu: null, browser: 'msedge' }), 'windows-26200-unknown-gpu-msedge');
    assert.throws(() => machineSlug({ platform: 'linux' }), /macOS and Windows only, not linux/);
    assert.equal(firstGpu(['Microsoft Basic Display Adapter', 'Parsec Virtual Display Adapter', ' NVIDIA GeForce RTX 4070 ', '']), 'NVIDIA GeForce RTX 4070');
    assert.equal(firstGpu(['Microsoft Remote Display Adapter']), null);
    assert.equal(macosMajorFromDarwin(25), 26);
    assert.equal(macosMajorFromDarwin(24), 15);
    assert.match(machineSlug({ platform: 'darwin', macosMajor: 26, cpu: 'Apple M5 Max' }), /^[a-z0-9]+(-[a-z0-9]+)*$/);
});

test('compat:gpu steps: build, browser, pack, the full nightly, probes, negatives, then the record with its tarballs; failures are data', () =>
{
    const work = join('.compat', 'gpu', 'full');
    const steps = planSteps(parseArguments([]), context);
    const labels = steps.map((step) => step.label);

    assert.deepEqual(labels, ['install the workspace', 'build the workspace', 'install the pinned Chromium', 'pack the artifacts', 'run every nightly cell', 'run the boundary probes', 'run the incompatible pairs', 'build the verification record']);
    const by = (label) => steps.find((step) => step.label === label);

    assert.deepEqual(by('run every nightly cell').command.args.slice(1), ['run', '--tier', 'nightly', '--patches', 'all', '--gpu', 'hardware', '--browser', 'chromium', '--no-cache', '--work', work, '--tarballs', join(work, 'tarballs')]);
    for (const label of ['run every nightly cell', 'run the boundary probes', 'run the incompatible pairs']) assert.equal(by(label).fatal, false, label);
    for (const label of ['install the workspace', 'build the workspace', 'pack the artifacts', 'build the verification record']) assert.equal(by(label).fatal, true, label);
    assert.deepEqual(by('build the verification record').command.args.slice(1), ['build', '--work', work, '--tarballs', join(work, 'tarballs'), '--date', '2026-10-12', '--commit', 'a'.repeat(40), '--machine', 'macos-26-apple-m5-max', '--scope', 'full']);
    assert.ok(steps.every((step) => step.command.shell === false), 'no shell off Windows');
});

test('compat:gpu steps on Windows with chrome: pnpm through its .cmd shim, no Chromium install, --browser passed through', () =>
{
    const steps = planSteps(parseArguments(['--browser', 'chrome', '--targeted']), { ...context, platform: 'win32' });

    assert.deepEqual(steps.map((step) => step.label), ['install the workspace', 'build the workspace', 'pack the artifacts', 'run the targeted cells', 'build the verification record']);
    assert.equal(steps[0].command.file, 'pnpm.cmd');
    const targeted = steps.find((step) => step.label === 'run the targeted cells').command.args;

    assert.ok(targeted.includes('chrome') && targeted.includes(TARGETED.react) && targeted.includes(TARGETED.pixi));
    assert.equal(steps.at(-1).command.args.at(-1), 'partial');
    assert.deepEqual(planSteps(parseArguments(['--no-build']), context).map((step) => step.label).slice(0, 2), ['install the pinned Chromium', 'pack the artifacts']);
});

test('compat:gpu --push: a new records branch from HEAD, only the records directory, one [skip ci] commit, one push', () =>
{
    const commands = pushCommands({ slug: 'windows-26200-nvidia-geforce-rtx-4070-chrome', date: '2026-10-12', recordId: '2026-10-12-windows-26200-nvidia-geforce-rtx-4070-chrome' });

    assert.deepEqual(commands, [
        ['switch', '-c', 'records/windows-26200-nvidia-geforce-rtx-4070-chrome-2026-10-12'],
        ['add', join('design', 'compatibility', 'verification')],
        ['commit', '-m', 'Add the hardware verification record 2026-10-12-windows-26200-nvidia-geforce-rtx-4070-chrome [skip ci]'],
        ['push', '-u', 'origin', 'records/windows-26200-nvidia-geforce-rtx-4070-chrome-2026-10-12'],
    ]);
});

test('safeWorkDir only accepts a dedicated directory under the checkout\'s .compat*', () =>
{
    const root = join('/', 'repo', 'pixi-react');

    assert.equal(safeWorkDir(root, '.compat/gpu/full'), join(root, '.compat', 'gpu', 'full'));
    assert.equal(safeWorkDir(root, join(root, '.compat-gpu', 'x')), join(root, '.compat-gpu', 'x'));
    for (const bad of ['.', '..', '../..', root, join('/', 'repo'), '/', 'packages', 'design/compatibility', '.compat/../packages', '.git', join('/', 'tmp', 'gpu')])
    {
        assert.throws(() => safeWorkDir(root, bad), /not a dedicated output directory/, bad);
    }
});
