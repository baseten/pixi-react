import { Container } from 'pixi.js';
import { useState } from 'react';
import {
    Application,
    extend,
    type PixiReactElementProps,
} from '@pixi/react';
import { useExampleHarness } from '../../harness'; // @harness
import { Star } from './Star';

// Registering the class makes <pixiStar> available: the element name is `pixi` plus the key.
extend({
    Container,
    Star,
});

// Tell TypeScript about the new element and its props.
declare module '@pixi/react'
{
    interface PixiElements
    {
        pixiStar: PixiReactElementProps<typeof Star>;
    }
}

function Stars({ points }: { points: number })
{
    useExampleHarness({ points }); // @harness

    return (
        <pixiContainer label="stars" y={160}>
            <pixiStar label="star-yellow" x={100} points={points} />
            <pixiStar label="star-pink" x={240} points={points + 1} radius={64} fillColor={0xf472b6} />
            <pixiStar label="star-green" x={380} points={points + 2} fillColor={0x4ade80} />
        </pixiContainer>
    );
}

export default function CustomComponents()
{
    const harness = useExampleHarness(); // @harness
    const [points, setPoints] = useState(5);

    return (
        <div>
            <Application
                width={480}
                height={320}
                background="#0f172a"
                {...harness.options} // @harness
                onInit={harness.attach} // @harness
            >
                <Stars points={points} />
            </Application>
            <p style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setPoints(points + 1)}>Add a point</button>
                <button type="button" onClick={() => setPoints(5)}>Reset</button>
            </p>
        </div>
    );
}
