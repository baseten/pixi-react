// Type-only functions are never invoked; no asset request is performed.
import { Assets } from '@pixi/assets';
import { Texture } from 'pixi.js';

const init = (): Promise<void> => Assets.init();
const load = (source: string): Promise<Texture | Record<string, Texture>> => Assets.load<Texture>(source);
const unload = (source: string): Promise<void> => Assets.unload(source);
const add = (alias: string, source: string): void => { Assets.add(alias, source); };
const loadBundle = (name: string): Promise<unknown> => Assets.loadBundle(name);

void init;
void load;
void unload;
void add;
void loadBundle;
