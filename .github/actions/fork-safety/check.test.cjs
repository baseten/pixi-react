const assert = require('node:assert/strict');
const { test } = require('node:test');
const { validate } = require('./check.cjs');

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
