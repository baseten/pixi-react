#!/usr/bin/env node
/* eslint-disable no-console -- command-line script: its output is the report. */
/**
 * Reads the Playwright JSON report (.playwright/results.json) and prints a per-project summary, also to
 * $GITHUB_STEP_SUMMARY when set.
 *
 *   node scripts/check-report.mjs --require functional --require visual    # the required check
 *   node scripts/check-report.mjs --report webgpu-smoke                    # informational: never fails
 *
 * A required project fails the check unless it ran at least one test and every test passed: a failed, flaky,
 * interrupted or missing run fails, and in CI so does a skipped test, so a required snapshot can never be skipped
 * silently. Outside CI a skip is a warning (the visual project skips on platforms without baselines). Skip reasons
 * are printed for every project, which is how the non-required WebGPU smoke test reports a missing adapter.
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const reportPath = fileURLToPath(new URL('../.playwright/results.json', import.meta.url));
const args = process.argv.slice(2);
const option = (name) => args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]] : []));
const required = option('--require');
const informational = option('--report');
const ci = !!process.env.CI;
const lines = [];
const problems = [];

function *tests(suite, titles = [])
{
    const path = suite.title ? [...titles, suite.title] : titles;

    for (const spec of suite.specs ?? [])
    {
        for (const test of spec.tests) yield { title: [...path, spec.title].join(' › '), test };
    }
    for (const child of suite.suites ?? []) yield *tests(child, path);
}

if (!existsSync(reportPath))
{
    problems.push(`no report at ${reportPath}: Playwright did not finish`);
}
else
{
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const all = report.suites.flatMap((suite) => [...tests(suite)]);

    for (const error of report.errors ?? []) problems.push(`Playwright error: ${error.message?.split('\n')[0]}`);

    lines.push('| Project | Required | Passed | Failed | Flaky | Skipped |', '| --- | --- | --- | --- | --- | --- |');
    const skipNotes = [];

    for (const project of [...required, ...informational])
    {
        const isRequired = required.includes(project);
        const own = all.filter(({ test }) => test.projectName === project);
        const count = (status) => own.filter(({ test }) => test.status === status).length;
        const passed = own.filter(({ test }) => test.status === 'expected' && test.results.at(-1)?.status === 'passed').length;
        const skipped = own.filter(({ test }) => test.status === 'skipped' || test.results.at(-1)?.status === 'skipped');

        lines.push(`| ${project} | ${isRequired ? 'yes' : '**no**'} | ${passed} | ${count('unexpected')} | ${count('flaky')} | ${skipped.length} |`);
        for (const { title, test } of skipped)
        {
            const reason = test.annotations.find((annotation) => annotation.type === 'skip')?.description ?? 'no reason given';

            skipNotes.push(`- ${project}: skipped "${title}": ${reason}`);
        }
        if (!isRequired) continue;
        if (own.length === 0) problems.push(`${project}: no tests ran`);
        if (count('unexpected') || count('flaky')) problems.push(`${project}: ${count('unexpected')} failed, ${count('flaky')} flaky`);
        if (skipped.length)
        {
            const message = `${project}: ${skipped.length} skipped; a required project must run every test`;

            if (ci) problems.push(message);
            else console.warn(`warning: ${message} (allowed outside CI)`);
        }
        const unaccounted = own.length - passed - count('unexpected') - count('flaky') - skipped.length;

        if (unaccounted) problems.push(`${project}: ${unaccounted} tests with no passing result`);
    }
    if (skipNotes.length) lines.push('', ...skipNotes);
}

if (problems.length) lines.push('', '**Failed:**', ...problems.map((problem) => `- ${problem}`));
const summary = `### Examples browser tests\n\n${lines.join('\n')}\n`;

console.log(summary);
if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`);
if (problems.length && required.length) process.exit(1);
