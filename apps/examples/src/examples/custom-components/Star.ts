import {
    Container,
    type ContainerOptions,
    Graphics,
} from 'pixi.js';

export interface StarOptions extends ContainerOptions
{
    points?: number;
    radius?: number;
    fillColor?: number;
}

/**
 * A custom Pixi class: a Container that draws a star into a Graphics it owns. Its options are also properties with
 * setters, so @pixi/react can pass them to the constructor when it creates the node and assign them when props change.
 */
export class Star extends Container
{
    private readonly shape: Graphics;
    private _points: number;
    private _radius: number;
    private _fillColor: number;

    constructor({ points = 5, radius = 48, fillColor = 0xfacc15, ...options }: StarOptions = {})
    {
        super(options);
        this.shape = this.addChild(new Graphics({ label: 'star-shape' }));
        this._points = points;
        this._radius = radius;
        this._fillColor = fillColor;
        this.redraw();
    }

    get points(): number
    {
        return this._points;
    }

    set points(value: number)
    {
        this._points = value;
        this.redraw();
    }

    get radius(): number
    {
        return this._radius;
    }

    set radius(value: number)
    {
        this._radius = value;
        this.redraw();
    }

    get fillColor(): number
    {
        return this._fillColor;
    }

    set fillColor(value: number)
    {
        this._fillColor = value;
        this.redraw();
    }

    private redraw(): void
    {
        this.shape.clear();
        this.shape.star(0, 0, this._points, this._radius, this._radius / 2);
        this.shape.fill({ color: this._fillColor });
    }
}
