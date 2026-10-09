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

describe('React 19.1 host keys against its neighbours', () =>
{
    const keys = Object.keys(hostConfig.createHostConfig());

    it('drops the hooks 0.32 stopped reading and adds scheduler instrumentation, but not the 0.33 suspension hooks', () =>
    {
        expect(hostConfig.UNREACHABLE_HOST_KEYS).not.toHaveProperty('afterActiveInstanceBlur');
        expect(keys).toContain('trackSchedulerEvent');
        expect(keys).not.toContain('getSuspendedCommitReason');
    });
});
