import {
    Assets,
    Container,
    Graphics,
    Sprite,
    Texture,
} from 'pixi.js';
import {
    useCallback,
    useEffect,
    useState,
} from 'react';
import {
    Application,
    extend,
} from '@pixi/react';
import tokenUrl from '../../assets/token.png';
import { useExampleHarness } from '../../harness'; // @harness

// extend tells @pixi/react which Pixi.js classes it may create: here <pixiContainer>, <pixiGraphics> and <pixiSprite>.
extend({
    Container,
    Graphics,
    Sprite,
});

function Scene()
{
    const [texture, setTexture] = useState(Texture.EMPTY);

    useExampleHarness({ textureLoaded: texture !== Texture.EMPTY }, texture !== Texture.EMPTY); // @harness

    // The texture is a file bundled with the app, so loading it never leaves the page's origin.
    useEffect(() =>
    {
        let cancelled = false;

        void Assets.load<Texture>(tokenUrl).then((loaded) =>
        {
            if (!cancelled) setTexture(loaded);
        });

        return () =>
        {
            cancelled = true;
        };
    }, []);

    const drawPanel = useCallback((graphics: Graphics) =>
    {
        graphics.clear();
        graphics.roundRect(0, 0, 320, 200, 16);
        graphics.fill({ color: 0x1e293b });
        graphics.stroke({ color: 0x38bdf8, width: 4 });
    }, []);

    return (
        <pixiContainer label="panel" x={80} y={60}>
            <pixiGraphics label="background" draw={drawPanel} />
            <pixiSprite label="token" texture={texture} anchor={0.5} x={160} y={100} scale={2} />
        </pixiContainer>
    );
}

export default function BasicScene()
{
    const harness = useExampleHarness(); // @harness

    return (
        <Application
            width={480}
            height={320}
            background="#0f172a"
            {...harness.options} // @harness
            onInit={harness.attach} // @harness
        >
            <Scene />
        </Application>
    );
}
