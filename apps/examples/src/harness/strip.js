/**
 * The docs show each example as a user would write it: every line that mentions the harness marker is removed, a run
 * of blank lines left behind collapses to one, and a blank line left at the start of a block is dropped. Shared by the docs (apps/docs/src/components/LocalExample) and
 * test/catalog.test.mjs.
 */
export const HARNESS_MARKER = '@harness';

/** @param {string} source */
export function stripHarness(source)
{
    return source
        .split('\n')
        .filter((line) => !line.includes(HARNESS_MARKER))
        .join('\n')
        .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
        .replace(/([{(]\n)[ \t]*\n/g, '$1');
}
