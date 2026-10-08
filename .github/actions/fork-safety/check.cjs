const fs = require('node:fs');
const path = require('node:path');

const repository = 'baseten/pixi-react';
const packageName = JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')).name;

function validate(mode, env = process.env, name = packageName)
{
    if (env.GITHUB_REPOSITORY !== repository)
    {
        throw new Error(`Publication requires GITHUB_REPOSITORY=${repository}`);
    }

    if (mode === 'docs')
    {
        if (env.FORK_DOCS_ENABLED !== 'true' || env.FORK_DOCS_REPOSITORY !== repository)
        {
            throw new Error('Docs deployment requires explicit fork enablement and destination');
        }
    }
    else if (mode === 'release' || mode === 'preview')
    {
        const enabled = mode === 'release' ? env.FORK_RELEASE_ENABLED : env.FORK_PREVIEW_ENABLED;

        if (enabled !== 'true' || !env.FORK_PACKAGE_NAME || env.FORK_PACKAGE_NAME !== name
            || name.startsWith('@pixi/'))
        {
            throw new Error('Publication requires explicit enablement and a matching non-@pixi fork package name');
        }
    }
    else
    {
        throw new Error(`Unknown publication mode: ${mode}`);
    }
}

function review(env = process.env)
{
    console.log(JSON.stringify({
        repository: env.GITHUB_REPOSITORY || '(local)',
        allowedRepository: repository,
        manifestPackage: packageName,
        configuredPackage: env.FORK_PACKAGE_NAME || '(unset)',
        npmRegistry: 'https://registry.npmjs.org',
        previewService: 'https://pkg.pr.new',
        releaseEnabled: env.FORK_RELEASE_ENABLED === 'true',
        previewEnabled: env.FORK_PREVIEW_ENABLED === 'true',
        docsEnabled: env.FORK_DOCS_ENABLED === 'true',
        configuredDocsRepository: env.FORK_DOCS_REPOSITORY || '(unset)',
        docsDestination: 'https://github.com/baseten/pixi-react/tree/gh-pages',
        docsUrl: 'https://baseten.github.io/pixi-react/',
        permissions: {
            verificationAndReview: 'contents: read; no publication secrets',
            preview: 'contents: read; no npm or GitHub publication token',
            release: 'contents: write; GITHUB_TOKEN and NPM_TOKEN in publication step only',
            docs: 'contents: write; GITHUB_TOKEN in deployment step only',
        },
        manualReviewOnly: true,
    }, null, 2));
}

module.exports = { validate, review };

if (require.main === module)
{
    if (process.argv[2] === 'review') review();
    else validate(process.argv[2]);
}
