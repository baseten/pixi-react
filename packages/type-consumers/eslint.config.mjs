// Shared workspace ESLint config; see the repository root. The fixtures compile only inside the isolated consumers
// that scripts/run.mjs installs (their packages are not resolvable from the workspace), so they are not linted here:
// the runner typechecks them.
import config from '../../eslint.config.mjs';

export default [{ ignores: ['fixtures/**/*'] }, ...config];
