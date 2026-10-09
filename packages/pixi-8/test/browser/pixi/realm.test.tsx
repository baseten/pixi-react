import * as pixi from 'pixi.js';
import { afterEach, describe, expect, it } from 'vitest';
import { setup } from './harness';
import { CompatibilityError } from '@pixi-react-provisional/core';

const frames: HTMLIFrameElement[] = [];

afterEach(() =>
{
    frames.splice(0).forEach((frame) => frame.remove());
});

describe(`root targets on pixi.js ${pixi.VERSION}`, () =>
{
    it('accepts a canvas from another DOM realm (an iframe) and rejects a non-canvas target', () =>
    {
        const { adapter } = setup();
        const frame = document.createElement('iframe');

        document.body.append(frame);
        frames.push(frame);

        const foreign = frame.contentDocument!.createElement('canvas');

        expect(foreign instanceof HTMLCanvasElement, 'not an instance of this realm\'s canvas').toBe(false);
        expect(() => adapter.createSession(undefined as never, foreign)).not.toThrow();

        let error: unknown;

        try
        {
            adapter.createSession(undefined as never, frame.contentDocument!.createElement('div') as never);
        }
        catch (caught)
        {
            error = caught;
        }

        expect(error).toBeInstanceOf(CompatibilityError);
        expect((error as CompatibilityError).code).toBe('ABI_MISMATCH');
    });
});
