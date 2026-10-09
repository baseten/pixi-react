import { describe, expect, it } from 'vitest';
import { createCoreBinding } from './core-binding/binding';

/** How a render promise ends, or 'pending' if it is still unsettled after a bounded wait. */
async function settle(promise: Promise<unknown>): Promise<{ status: string; value?: unknown }>
{
    const pending = new Promise<{ status: string }>((resolve) => setTimeout(() => resolve({ status: 'pending' }), 100));

    return Promise.race([
        promise.then((value) => ({ status: 'resolved', value }), (value: unknown) => ({ status: 'rejected', value })),
        pending,
    ]);
}

describe('core + renderer: render promises across unmount', () =>
{
    it('rejects an in-flight render with ROOT_DISPOSED when the root unmounts before its commit', async () =>
    {
        const composition = createCoreBinding().create();

        try
        {
            const root = composition.api.createRoot(document.createElement('canvas'));

            await root.render(<></>, { ...composition.appOptions });

            // A ready root runs the render task at once; its commit is still pending when unmount starts.
            const inFlight = root.render(<></>, { ...composition.appOptions });

            await root.unmount?.();

            const outcome = await settle(inFlight);

            expect(outcome.status).toBe('rejected');
            expect((outcome.value as { code?: string }).code).toBe('ROOT_DISPOSED');
        }
        finally
        {
            await composition.dispose();
        }
    });
});
