import {
    type Application as PixiApplication,
    Graphics,
} from 'pixi.js';
import {
    useCallback,
    useState,
} from 'react';
import {
    Application,
    extend,
} from '@pixi/react';
import { useExampleHarness } from '../../harness'; // @harness

extend({ Graphics });

function Badge()
{
    useExampleHarness({ badge: true }); // @harness

    const draw = useCallback((graphics: Graphics) =>
    {
        graphics.clear();
        graphics.circle(0, 0, 72);
        graphics.fill({ color: 0x22c55e });
        graphics.circle(0, 0, 40);
        graphics.fill({ color: 0x14532d });
    }, []);

    return <pixiGraphics label="badge" draw={draw} x={240} y={160} />;
}

export default function InitAndUnmount()
{
    const harness = useExampleHarness(); // @harness
    const [mounted, setMounted] = useState(true);
    // Changing an Application's key unmounts it and mounts a new one: a new canvas and a new Pixi application.
    const [generation, setGeneration] = useState(1);
    const [log, setLog] = useState<string[]>([]);

    // onInit runs once per Application, after Pixi's asynchronous init has finished and before the children render.
    const handleInit = (app: PixiApplication) =>
    {
        harness.attach(app); // @harness
        setLog((entries) => [...entries, `${entries.length + 1}. Application ${generation}: ${app.renderer.name} ${app.screen.width}x${app.screen.height}`]);
    };

    return (
        <div>
            {mounted
                ? (
                    <Application
                        key={generation}
                        width={480}
                        height={320}
                        background="#0f172a"
                        {...harness.options} // @harness
                        onInit={handleInit}
                    >
                        <Badge />
                    </Application>
                )
                : <p>Unmounted: the canvas is removed and the Pixi application destroyed.</p>}
            <p style={{ display: 'flex', gap: 8 }}>
                <button
                    type="button"
                    onClick={() =>
                    {
                        if (mounted) harness.detach(); // @harness
                        setMounted(!mounted);
                    }}
                >
                    {mounted ? 'Unmount' : 'Mount'}
                </button>
                <button type="button" disabled={!mounted} onClick={() => setGeneration(generation + 1)}>
                    Remount
                </button>
            </p>
            <ol aria-label="Initializations">
                {log.map((entry) => <li key={entry}>{entry}</li>)}
            </ol>
        </div>
    );
}
