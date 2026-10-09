import {
    Container,
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

extend({
    Container,
    Graphics,
});

const COLORS = { blue: 0x3b82f6, orange: 0xf97316 } as const;

type ColorName = keyof typeof COLORS;

interface SceneProps
{
    clicks: number;
    color: ColorName;
    onPress: () => void;
}

function Scene({ clicks, color, onPress }: SceneProps)
{
    const [hovered, setHovered] = useState(false);
    const markers = Math.min(clicks, 8);

    useExampleHarness({ clicks, color, hovered, markers }); // @harness

    // The draw callback changes with `color`, so a new color redraws the button.
    const drawButton = useCallback((graphics: Graphics) =>
    {
        graphics.clear();
        graphics.roundRect(-100, -48, 200, 96, 24);
        graphics.fill({ color: COLORS[color] });
    }, [color]);

    const drawMarker = useCallback((graphics: Graphics) =>
    {
        graphics.clear();
        graphics.rect(0, 0, 24, 24);
        graphics.fill({ color: 0xe2e8f0 });
    }, []);

    return (
        <pixiContainer label="scene">
            <pixiGraphics
                label="button"
                draw={drawButton}
                x={240}
                y={140}
                scale={hovered ? 1.1 : 1}
                eventMode="static"
                cursor="pointer"
                onPointerTap={onPress}
                onPointerOver={() => setHovered(true)}
                onPointerOut={() => setHovered(false)} />
            {/* One marker per click (up to 8): React adds and removes Pixi children as the count changes. */}
            <pixiContainer label="markers" x={240 - (markers * 32) / 2} y={240}>
                {Array.from({ length: markers }, (_, index) => (
                    <pixiGraphics key={index} label={`marker-${index}`} draw={drawMarker} x={index * 32 + 4} />
                ))}
            </pixiContainer>
        </pixiContainer>
    );
}

export default function UpdatesAndEvents()
{
    const harness = useExampleHarness(); // @harness
    const [clicks, setClicks] = useState(0);
    const [color, setColor] = useState<ColorName>('blue');

    return (
        <div>
            <Application
                width={480}
                height={320}
                background="#0f172a"
                {...harness.options} // @harness
                onInit={harness.attach} // @harness
            >
                <Scene clicks={clicks} color={color} onPress={() => setClicks((count) => count + 1)} />
            </Application>
            <p style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <output aria-label="Clicks">{clicks}</output>
                <button type="button" onClick={() => setClicks(0)}>Reset</button>
                <button type="button" onClick={() => setColor(color === 'blue' ? 'orange' : 'blue')}>
                    Change color
                </button>
            </p>
        </div>
    );
}
