import {
    Container,
    ExtensionType,
    Graphics,
    type Ticker,
} from 'pixi.js';
import {
    useCallback,
    useRef,
    useState,
} from 'react';
import { useExampleHarness } from '../../harness'; // @harness
import {
    Application,
    component,
    useApplication,
    useTick,
} from './pixi-react';

// component(Ctor) registers a class with this renderer and returns a typed React component; no global JSX is needed.
const PixiContainer = component(Container);
const PixiGraphics = component(Graphics);

/** An Application plugin whose init throws, to make initialization fail on purpose. */
const failingPlugin = {
    type: ExtensionType.Application,
    name: 'example-failing-plugin',
    // Runs before Pixi's own Application plugins, so nothing else is set up when it throws.
    priority: 1000,
    ref: {
        init()
        {
            throw new Error('Deliberate initialization failure');
        },
        destroy()
        {
            // init threw before setting anything up.
        },
    },
};

const NO_EXTENSIONS: never[] = [];
const FAILING_EXTENSIONS = [failingPlugin];

function Scene()
{
    const { app } = useApplication();
    const squareRef = useRef<Graphics>(null);

    useExampleHarness({ composition: 'createRenderer' }); // @harness

    const spin = useCallback((ticker: Ticker) =>
    {
        if (squareRef.current) squareRef.current.rotation -= 0.04 * ticker.deltaTime;
    }, []);

    useTick(spin);

    const draw = useCallback((graphics: Graphics) =>
    {
        graphics.clear();
        graphics.rect(-56, -56, 112, 112);
        graphics.fill({ color: 0xf43f5e });
        graphics.rect(-8, -56, 16, 40);
        graphics.fill({ color: 0x4c0519 });
    }, []);

    return (
        <PixiContainer label="scene" x={app.screen.width / 2} y={app.screen.height / 2}>
            <PixiGraphics ref={squareRef} label="square" draw={draw} />
        </PixiContainer>
    );
}

export default function ModularRenderer()
{
    const harness = useExampleHarness(); // @harness
    const [failNext, setFailNext] = useState(false);
    // A failed root is not retried: a new key mounts a new Application.
    const [attempt, setAttempt] = useState(1);
    const [error, setError] = useState<string | null>(null);

    const restart = (fail: boolean) =>
    {
        setFailNext(fail);
        setError(null);
        setAttempt(attempt + 1);
    };

    return (
        <div>
            <Application
                key={attempt}
                width={480}
                height={320}
                background="#0f172a"
                extensions={failNext ? FAILING_EXTENSIONS : NO_EXTENSIONS}
                {...harness.options} // @harness
                onInit={harness.attach} // @harness
                // onInitError is one of the modular renderer's root error callbacks; without it the error is logged.
                onInitError={(cause) =>
                {
                    harness.fail(cause); // @harness
                    setError(cause instanceof Error ? cause.message : String(cause));
                }}
            >
                <Scene />
            </Application>
            {error ? <p role="alert">Initialization failed: {error}</p> : null}
            <p style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => restart(true)}>Fail initialization</button>
                <button type="button" onClick={() => restart(false)}>Retry</button>
            </p>
        </div>
    );
}
