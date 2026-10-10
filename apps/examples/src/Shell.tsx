import { Suspense, useEffect, useMemo, useSyncExternalStore } from 'react';
import { type ExampleBackend, type ExampleMode, Harness, HarnessProvider } from './harness';
import { components, type ExampleEntry, examples } from './routes';

function Status({ harness }: { harness: Harness })
{
    const status = useSyncExternalStore(
        (listener) => harness.subscribe(listener),
        () => `${harness.state.status}${harness.state.firstFrame ? ', first frame rendered' : ''}`,
    );

    return <span>Status: {status}</span>;
}

function ExampleRoute({ example, mode, backend }: { example: ExampleEntry; mode: ExampleMode; backend: ExampleBackend })
{
    const Example = components[example.id];
    const harness = useMemo(() => new Harness(example.id, mode, backend), [example.id, mode, backend]);

    useEffect(() => harness.install(), [harness]);

    return (
        <main>
            <h1>{example.title}</h1>
            <p>{example.summary}</p>
            <p className="meta">
                {example.composition === 'facade' ? 'Facade: @pixi/react' : 'Explicit createRenderer composition'}
                {' · '}
                <Status harness={harness} />
                {mode === 'test'
                    ? (
                        <>
                            {' · test mode, ticker stopped · '}
                            <button type="button" onClick={() => window.__EXAMPLE_CONTROL__?.step(1)}>Step one frame</button>
                        </>
                    )
                    : (
                        <>
                            {' · '}
                            <a href={`?test`}>Open in test mode</a>
                        </>
                    )}
            </p>
            <section
                ref={(element) => harness.setElement(element)}
                data-testid="example"
                data-example={example.id}
                data-mode={mode}
            >
                <HarnessProvider harness={harness}>
                    <Suspense fallback={<p>Loading the example…</p>}>
                        <Example />
                    </Suspense>
                </HarnessProvider>
            </section>
        </main>
    );
}

function Index()
{
    return (
        <main data-testid="index">
            <h1>@pixi/react examples</h1>
            <p>
                Built from this repository&apos;s workspace packages, not from npm. Each example has its own route; add
                {' '}<code>?test</code> for the deterministic test mode (stopped ticker, fixed steps).
            </p>
            <ul>
                {examples.map((example) => (
                    <li key={example.id}>
                        <a href={`/${example.id}`}>{example.title}</a> ({example.composition}): {example.summary}
                    </li>
                ))}
            </ul>
        </main>
    );
}

function Page({ id, mode, backend }: { id: string; mode: ExampleMode; backend: ExampleBackend })
{
    if (id === '') return <Index />;
    const example = examples.find((entry) => entry.id === id);

    if (!example) return <main data-testid="not-found"><h1>No example named “{id}”</h1></main>;

    return <ExampleRoute example={example} mode={mode} backend={backend} />;
}

export function Shell({ path, mode, backend = 'webgl' }: { path: string; mode: ExampleMode; backend?: ExampleBackend })
{
    return (
        <>
            <nav>
                <a href="/">Examples</a>
                {examples.map((entry) => <a key={entry.id} href={`/${entry.id}${mode === 'test' ? '?test' : ''}`}>{entry.title}</a>)}
            </nav>
            <Page id={path.replace(/^\/+|\/+$/g, '')} mode={mode} backend={backend} />
        </>
    );
}
