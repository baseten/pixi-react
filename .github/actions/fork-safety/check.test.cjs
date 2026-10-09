const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validate, packageDirectory, packageName } = require('./check.cjs');

const configured = {
    GITHUB_REPOSITORY: 'baseten/pixi-react',
    FORK_RELEASE_ENABLED: 'true',
    FORK_PREVIEW_ENABLED: 'true',
    FORK_PACKAGE_NAME: '@baseten/pixi-react',
    FORK_DOCS_ENABLED: 'true',
    FORK_DOCS_REPOSITORY: 'baseten/pixi-react',
};

for (const mode of ['release', 'preview'])
{
    test(`${mode} fails closed for defaults and inherited package`, () => {
        assert.throws(() => validate(mode, {}, '@pixi/react'));
        assert.throws(() => validate(mode, {
            ...configured,
            FORK_PACKAGE_NAME: '@pixi/react',
        }, '@pixi/react'));
        assert.throws(() => validate(mode, configured, '@baseten/other-package'));
        assert.throws(() => validate(mode, {
            ...configured,
            GITHUB_REPOSITORY: 'pixijs/pixi-react',
        }, configured.FORK_PACKAGE_NAME));
        for (const disabled of ['', 'false', 'TRUE'])
        {
            assert.throws(() => validate(mode, {
                ...configured,
                [mode === 'release' ? 'FORK_RELEASE_ENABLED' : 'FORK_PREVIEW_ENABLED']: disabled,
            }, configured.FORK_PACKAGE_NAME));
        }
        assert.doesNotThrow(() => validate(mode, configured, configured.FORK_PACKAGE_NAME));
    });
}

test('docs requires fork enablement and an exact fork destination', () => {
    assert.throws(() => validate('docs', {}));
    assert.throws(() => validate('docs', { ...configured, FORK_DOCS_ENABLED: 'false' }));
    assert.throws(() => validate('docs', { ...configured, FORK_DOCS_REPOSITORY: 'pixijs/pixi-react' }));
    assert.throws(() => validate('docs', { ...configured, GITHUB_REPOSITORY: 'pixijs/pixi-react' }));
    assert.doesNotThrow(() => validate('docs', configured));
});

test('unconfigured semantic release is a dry run without publishing plugins', () => {
    const { execFileSync } = require('node:child_process');
    const result = execFileSync(process.execPath, ['-e', 'console.log(JSON.stringify(require("./release.config.js")))'], {
        cwd: require('node:path').join(__dirname, '../../..'),
        env: { ...process.env, FORK_RELEASE_ENABLED: '' },
        encoding: 'utf8',
    });
    const config = JSON.parse(result);

    assert.equal(config.dryRun, true);
    assert.equal(config.repositoryUrl, 'https://github.com/baseten/pixi-react.git');
    assert.deepEqual(config.plugins, ['@semantic-release/commit-analyzer', '@semantic-release/release-notes-generator']);
});

test('publication guards read the facade workspace manifest, not the private root', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.join(__dirname, '../../..');
    const rootManifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const facadeManifest = JSON.parse(fs.readFileSync(path.join(root, packageDirectory, 'package.json'), 'utf8'));

    assert.equal(rootManifest.private, true);
    assert.notEqual(rootManifest.name, facadeManifest.name);
    assert.equal(packageName, facadeManifest.name);
    for (const mode of ['release', 'preview'])
    {
        // The default name is the facade manifest's, so the root name never satisfies the guard.
        assert.throws(() => validate(mode, { ...configured, FORK_PACKAGE_NAME: rootManifest.name }));
        if (facadeManifest.name.startsWith('@pixi/'))
        {
            assert.throws(() => validate(mode, { ...configured, FORK_PACKAGE_NAME: facadeManifest.name }));
        }
    }
});

test('configured semantic release fails closed for an @pixi name and publishes from the facade workspace', () => {
    const { execFileSync } = require('node:child_process');
    const options = {
        cwd: require('node:path').join(__dirname, '../../..'),
        env: { ...process.env, ...configured, FORK_RELEASE_ENABLED: 'true' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    };
    const load = 'console.log(JSON.stringify(require("./release.config.js")))';

    // While the facade manifest is still @pixi/react, enabling release must not load a publishing config.
    if (packageName.startsWith('@pixi/'))
    {
        assert.throws(() => execFileSync(process.execPath, ['-e', load], options));
    }

    // With the destination guard stubbed, the publishing plugins target the facade workspace.
    const stubbed = `require("./.github/actions/fork-safety/check.cjs").validate = () => {}; ${load}`;
    const config = JSON.parse(execFileSync(process.execPath, ['-e', stubbed], options));
    const npmPlugin = config.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === '@semantic-release/npm');

    assert.equal(config.dryRun, false);
    assert.equal(npmPlugin[1].pkgRoot, packageDirectory);
});
