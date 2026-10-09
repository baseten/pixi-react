import reactHooks from 'eslint-plugin-react-hooks';
import pixiConfig from '@pixi/eslint-config';

export default [
    {
        // Patterns resolve against the directory of the config ESLint loads:
        // the workspace root (lint-staged) or a package that re-exports this
        // file (`pnpm --filter <package> lint`). Both forms are listed.
        ignores: [
            'dist/**/*',
            'lib/**/*',
            'types/**/*',
            'build/**/*',
            '.docusaurus/**/*',
            'packages/*/dist/**/*',
            'packages/*/lib/**/*',
            'packages/*/types/**/*',
            'apps/docs/build/**/*',
            'apps/docs/.docusaurus/**/*',
            // Design probes import uninstalled React 17 / Pixi 6 packages.
            'design/**/*',
        ],
    },
    ...pixiConfig,
    {
        rules: {
            'max-len': 0,
            '@typescript-eslint/no-empty-object-type': [
                0,
                {
                    allowInterfaces: 'with-single-extends',
                },
            ],
        },
    },
    {
        files: [
            '*.test.ts',
            '*.test.tsx',
        ],
        rules: {
            '@typescript-eslint/dot-notation': [
                0,
                {
                    allowPrivateClassPropertyAccess: true,
                    allowProtectedClassPropertyAccess: true,
                    allowIndexSignaturePropertyAccess: true,
                },
            ],
            '@typescript-eslint/no-unused-expressions': 0,
            'dot-notation': 0,
        },
    },
    {
        ...reactHooks.configs['recommended-latest'],
        rules: {
            ...reactHooks.configs['recommended-latest'].rules,
            'react-hooks/exhaustive-deps': ['warn', {
                additionalHooks: '(useIsomorphicLayoutEffect)'
            }]
        }
    }
];
