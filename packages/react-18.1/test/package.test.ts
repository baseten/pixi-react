import * as hostConfig from '../src/hostConfig';
import * as entry from '../src/index';
import { describeReact18Package } from '@pixi-react-provisional/react-shared/test-support/react-18';

describeReact18Package({
    // Vitest runs each package's tests from its own directory (jsdom gives import.meta.url no file: scheme).
    packageDir: process.cwd(),
    hostConfig,
    entry,
});
