import {
    Container,
    Graphics,
    type Ticker,
} from 'pixi.js';
import {
    useCallback,
    useRef,
    useState,
} from 'react';
import {
    Application,
    extend,
    useApplication,
    useTick,
} from '@pixi/react';
import { useExampleHarness } from '../../harness'; // @harness

extend({
    Container,
    Graphics,
});

function Spinner({ running }: { running: boolean })
{
    // useApplication reads the Pixi Application from the nearest <Application>.
    const { app } = useApplication();
    const spinnerRef = useRef<Graphics>(null);

    useExampleHarness({ screen: [app.screen.width, app.screen.height], running }); // @harness

    // The tick callback changes the Pixi object directly: no React render per frame.
    // The rotation depends only on the ticker's deltaTime, so a fixed-step ticker gives the same frames every run.
    const spin = useCallback((ticker: Ticker) =>
    {
        const spinner = spinnerRef.current;

        if (!spinner) return;
        spinner.rotation += 0.05 * ticker.deltaTime;
    }, []);

    // isEnabled removes the callback from the ticker while it is false.
    useTick({ callback: spin, isEnabled: running });

    const draw = useCallback((graphics: Graphics) =>
    {
        graphics.clear();
        graphics.rect(-60, -60, 120, 120);
        graphics.fill({ color: 0xa78bfa });
        graphics.rect(-8, -60, 16, 40);
        graphics.fill({ color: 0x1e1b4b });
    }, []);

    return (
        <pixiGraphics
            ref={spinnerRef}
            label="spinner"
            draw={draw}
            x={app.screen.width / 2}
            y={app.screen.height / 2} />
    );
}

export default function HooksAndTicker()
{
    const harness = useExampleHarness(); // @harness
    const [running, setRunning] = useState(true);

    return (
        <div>
            <Application
                width={480}
                height={320}
                background="#0f172a"
                {...harness.options} // @harness
                onInit={harness.attach} // @harness
            >
                <Spinner running={running} />
            </Application>
            <p>
                <button type="button" onClick={() => setRunning(!running)}>{running ? 'Pause' : 'Resume'}</button>
            </p>
        </div>
    );
}
