// @vitest-environment node
/**
 * The error reference (issue 71): every code core links to has a docs page, and every message ends with its link, in
 * development and in production. A built-in or `core.` code without a page fails here.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { BUILTIN_CODES, DOCUMENTED_CODES } from '../src/errors.js';
import { CompatibilityError, CoreErrorCodes, ERROR_DOCS_URL, errorDocsUrl } from '../src/index.js';

import type { BuiltinCompatibilityErrorCode } from '../src/index.js';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const ERRORS_DIR = join(repo, 'apps/docs/docs/errors');

/** Every built-in code, by type: adding one to `BuiltinCompatibilityErrorCode` fails `tsc` here until it is listed. */
const ALL_BUILTIN: Record<BuiltinCompatibilityErrorCode, true> = {
    ABI_MISMATCH: true,
    CAPABILITY_MISSING: true,
    UNSUPPORTED_TUPLE: true,
    UNKNOWN_ELEMENT: true,
    UNSUPPORTED_NODE: true,
    REGISTRY_CONFLICT: true,
    ROOT_DISPOSED: true,
    INIT_FAILED: true,
};

const slugOf = (code: string) => errorDocsUrl(code).slice(ERROR_DOCS_URL.length, -1);

/** The namespaced codes our own adapters link with `docsUrl: errorDocsUrl('<code>')`, found in their sources. */
function firstPartyLinkedCodes(): string[]
{
    const codes = new Set<string>();
    const visit = (dir: string) =>
    {
        for (const entry of readdirSync(dir, { withFileTypes: true }))
        {
            const path = join(dir, entry.name);

            if (entry.isDirectory()) visit(path);
            else if ((/\.tsx?$/).test(entry.name))
            {
                for (const [, code] of readFileSync(path, 'utf8').matchAll(/errorDocsUrl\('([^']+)'\)/g)) codes.add(code);
            }
        }
    };

    for (const pkg of readdirSync(join(repo, 'packages')))
    {
        if (existsSync(join(repo, 'packages', pkg, 'src'))) visit(join(repo, 'packages', pkg, 'src'));
    }

    return [...codes].sort();
}

/** The `slug` front matter of a docs page. */
function frontMatterSlug(file: string): string | undefined
{
    const front = readFileSync(file, 'utf8').match(/^---\n([\s\S]*?)\n---/)?.[1] ?? '';

    return front.match(/^slug:\s*(\S+)\s*$/m)?.[1];
}

describe('error reference (issue 71)', () =>
{
    const env = process.env.NODE_ENV;

    afterEach(() =>
    {
        process.env.NODE_ENV = env;
    });

    it('lists every built-in code and every core code as documented', () =>
    {
        expect([...BUILTIN_CODES].sort()).toEqual(Object.keys(ALL_BUILTIN).sort());
        expect([...DOCUMENTED_CODES].sort()).toEqual([...Object.keys(ALL_BUILTIN), ...Object.values(CoreErrorCodes)].sort());
    });

    it('finds the first-party adapter codes that link to the reference', () =>
    {
        expect(firstPartyLinkedCodes()).toEqual(['react-18.FOREIGN_RUNTIME', 'react-19.FOREIGN_RUNTIME']);
    });

    it.each([...DOCUMENTED_CODES, ...firstPartyLinkedCodes()])('%s has a docs page at its URL', (code) =>
    {
        const slug = slugOf(code);
        const file = join(ERRORS_DIR, `${slug}.mdx`);

        expect(slug).toMatch(/^[A-Za-z0-9_-]+$/);
        expect(existsSync(file), `missing docs page apps/docs/docs/errors/${slug}.mdx for ${code}`).toBe(true);
        // The site serves the docs at the root of the base URL (routeBasePath '/'), so the slug is the URL path.
        expect(frontMatterSlug(file)).toBe(`/errors/${slug}`);
        expect(readFileSync(file, 'utf8')).toContain(`\`${code}\``);
    });

    it('has no page for a code that does not exist', () =>
    {
        const known = new Set([...DOCUMENTED_CODES, ...firstPartyLinkedCodes()].map(slugOf));
        const pages = readdirSync(ERRORS_DIR).filter((name) => name.endsWith('.mdx') && !name.startsWith('_') && name !== 'index.mdx');

        expect(pages.map((name) => name.slice(0, -'.mdx'.length)).filter((slug) => !known.has(slug))).toEqual([]);
    });

    it('builds URL-safe slugs', () =>
    {
        expect(errorDocsUrl('ABI_MISMATCH')).toBe('https://baseten.github.io/pixi-react/errors/ABI_MISMATCH/');
        expect(errorDocsUrl(CoreErrorCodes.TARGET_LEASED)).toBe('https://baseten.github.io/pixi-react/errors/core-TARGET_LEASED/');
    });

    it.each(['development', 'production'])('ends every documented message with its link in %s', (mode) =>
    {
        process.env.NODE_ENV = mode;

        for (const code of DOCUMENTED_CODES)
        {
            for (const message of ['', 'A message.'])
            {
                const error = new CompatibilityError(message, { code: code as BuiltinCompatibilityErrorCode, adapterIds: ['a'] });

                expect(error.docsUrl).toBe(errorDocsUrl(code));
                expect(error.message.endsWith(` See ${errorDocsUrl(code)}`)).toBe(true);
            }
        }
    });

    it('links an adapter-namespaced code only when the adapter supplies a page', () =>
    {
        const plain = new CompatibilityError('Unsupported format.', { code: 'community.shader.UNSUPPORTED_FORMAT', adapterIds: ['community.shader'] });
        const linked = new CompatibilityError('Unsupported format.', {
            code: 'community.shader.UNSUPPORTED_FORMAT',
            adapterIds: ['community.shader'],
            docsUrl: 'https://example.com/shader/errors#format',
        });

        expect(plain.message).toBe('Unsupported format.');
        expect(plain.docsUrl).toBeUndefined();
        expect(linked.message).toBe('Unsupported format. See https://example.com/shader/errors#format');
        expect(linked.docsUrl).toBe('https://example.com/shader/errors#format');
    });

    it('keeps core\'s page for a documented code, whatever docsUrl an adapter passes', () =>
    {
        const error = new CompatibilityError('Mismatch.', { code: 'ABI_MISMATCH', adapterIds: ['a'], docsUrl: 'https://example.com' });

        expect(error.message).toBe(`Mismatch. See ${errorDocsUrl('ABI_MISMATCH')}`);
    });
});
