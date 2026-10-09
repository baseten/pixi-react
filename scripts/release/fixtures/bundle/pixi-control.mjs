// Control: pixi.js alone, two named constructors. Shows the bundler can drop unused Pixi constructors at all.
import { Container, Sprite } from 'pixi.js';

export const constructors = [Container, Sprite];
export const result = () => ({ constructors: constructors.map((Ctor) => typeof Ctor) });
