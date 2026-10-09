import { type Application as PixiApplication } from 'pixi.js';
import { facadeCoreRuntime } from './facadeRuntime';

/** The default runtime's root record that owns `app`, if it still holds one. */
export function getAppRoot(app: PixiApplication)
{
    return facadeCoreRuntime().roots().find((root) => root.app === app);
}
