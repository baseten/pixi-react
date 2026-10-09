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
    rootArgument10: 'onDefaultTransitionIndicator',
});

describe('React 19.3 host keys against its neighbours', () =>
{
    const keys = Object.keys(hostConfig.createHostConfig());

    it('adds the 0.34 measure and view-transition hooks', () =>
    {
        expect(keys).toEqual(expect.arrayContaining(['measureInstance', 'wasInstanceInViewport', 'startViewTransition']));
    });
});
