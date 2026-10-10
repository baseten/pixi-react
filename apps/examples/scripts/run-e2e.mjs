#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Runs a Playwright project of the example browser tests with the environment it needs, portably (pnpm runs package
 * scripts through cmd.exe on Windows, which has no `VAR=value cmd` or `$?`).
 *
 *   node scripts/run-e2e.mjs dev [playwright args]      # functional tests against the dev server (EXAMPLES_SERVER=dev)
 *   node scripts/run-e2e.mjs webgpu [playwright args]   # the non-required WebGPU smoke test, then its report
 *
 * Exits with Playwright's status. For `webgpu` the report (scripts/check-report.mjs --report) always runs, also after a
 * failure, and never changes the exit status.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('..', import.meta.url));
const cli = createRequire(import.meta.url).resolve('@playwright/test/cli');
const [mode, ...extra] = process.argv.slice(2);
const modes = {
    dev: { env: { EXAMPLES_SERVER: 'dev' }, projects: ['functional'] },
    webgpu: { env: {}, projects: ['webgpu-smoke'], report: true },
};
const selected = modes[mode];

if (!selected)
{
    console.error(`usage: node scripts/run-e2e.mjs <${Object.keys(modes).join('|')}> [playwright args]`);
    process.exit(2);
}

function run(args, env = {})
{
    const result = spawnSync(process.execPath, args, { cwd: appRoot, stdio: 'inherit', env: { ...process.env, ...env } });

    if (result.error) throw result.error;

    // A signal (null status) counts as a failure.
    return result.status ?? 1;
}

const status = run([cli, 'test', ...selected.projects.map((project) => `--project=${project}`), ...extra], selected.env);

if (selected.report)
{
    run([fileURLToPath(new URL('./check-report.mjs', import.meta.url)), ...selected.projects.flatMap((project) => ['--report', project])]);
    console.log(`${selected.projects.join(', ')}: Playwright exited with ${status}${status ? ' (failed)' : ''}`);
}
process.exit(status);
