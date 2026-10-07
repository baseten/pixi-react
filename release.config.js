const { validate } = require('./.github/actions/fork-safety/check.cjs');
const enabled = process.env.FORK_RELEASE_ENABLED === 'true';

if (enabled) validate('release');

module.exports = {
    repositoryUrl: 'https://github.com/baseten/pixi-react.git',
    dryRun: !enabled,
    branches: [
        'main',
        {
            name: 'beta',
            prerelease: true,
        },
        {
            name: 'alpha',
            prerelease: true,
        },
    ],
    plugins: [
        '@semantic-release/commit-analyzer',
        '@semantic-release/release-notes-generator',
        ...(enabled ? [
            ['@semantic-release/npm', {
                npmPublish: true,
                tarballDir: 'dist',
            }],
            ['@semantic-release/github', {
                assets: 'dist/*.tgz',
                successComment: false,
                failComment: false,
                releasedLabels: false,
            }],
        ] : []),
    ],
};
