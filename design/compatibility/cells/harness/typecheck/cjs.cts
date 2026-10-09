// NodeNext CommonJS consumer: the `require` condition of every packed package, types included.
import { createRenderer } from '@pixi-react-provisional/renderer';
import { %REACT_CLASS% as ReactAdapterClass } from '%REACT_SPEC%';
import { %PIXI_CLASS% as PixiAdapterClass } from '%PIXI_SPEC%';

const renderer = createRenderer({ react: new ReactAdapterClass(), pixi: new PixiAdapterClass() });
const roots: number = renderer.runtime.roots().length;

export = { roots };
