// @vitest-environment node
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as hostConfig from '../src/hostConfig';
import * as entry from '../src/index';
import { describeReact19Package } from '@pixi-react-provisional/react-shared/test-support/react-19';

describeReact19Package({
    packageDir: fileURLToPath(new URL('..', import.meta.url)),
    hostConfig,
    entry,
    rootArgument10: 'transitionCallbacks',
});

describe('React 19.0 host keys against its neighbours', () =>
{
    const keys = Object.keys(hostConfig.createHostConfig());

    it('reads the 0.31 hooks 0.32 dropped, and none of the later instrumentation hooks', () =>
    {
        expect(hostConfig.UNREACHABLE_HOST_KEYS).toHaveProperty('afterActiveInstanceBlur');
        expect(keys).not.toContain('trackSchedulerEvent');
    });
});
