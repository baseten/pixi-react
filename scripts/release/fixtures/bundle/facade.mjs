// The default facade, registering two constructors through its module-level runtime.
import { Application, extend } from '__FACADE__';
import { Container, Sprite } from 'pixi.js';

extend({ Container, Sprite });

export const result = () => ({ application: typeof Application, extend: typeof extend });
