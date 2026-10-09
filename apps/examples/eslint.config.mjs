// Shared workspace ESLint config; see the repository root.
import config from '../../eslint.config.mjs';

export default [{ ignores: ['dist/**/*'] }, ...config];
