/**
 * Upstream `src/constants/EventPropNames.ts`: PascalCase React prop names and their Pixi 7 handler properties. Pixi 7.2
 * added these `on*` properties with its federated events; they are the same names as Pixi 8's.
 */
export const REACT_TO_PIXI_EVENT_PROP_NAMES: Readonly<Record<string, string>> = Object.freeze({
    onClick: 'onclick',
    onGlobalMouseMove: 'onglobalmousemove',
    onGlobalPointerMove: 'onglobalpointermove',
    onGlobalTouchMove: 'onglobaltouchmove',
    onMouseDown: 'onmousedown',
    onMouseEnter: 'onmouseenter',
    onMouseLeave: 'onmouseleave',
    onMouseMove: 'onmousemove',
    onMouseOut: 'onmouseout',
    onMouseOver: 'onmouseover',
    onMouseUp: 'onmouseup',
    onMouseUpOutside: 'onmouseupoutside',
    onPointerCancel: 'onpointercancel',
    onPointerDown: 'onpointerdown',
    onPointerEnter: 'onpointerenter',
    onPointerLeave: 'onpointerleave',
    onPointerMove: 'onpointermove',
    onPointerOut: 'onpointerout',
    onPointerOver: 'onpointerover',
    onPointerTap: 'onpointertap',
    onPointerUp: 'onpointerup',
    onPointerUpOutside: 'onpointerupoutside',
    onRightClick: 'onrightclick',
    onRightDown: 'onrightdown',
    onRightUp: 'onrightup',
    onRightUpOutside: 'onrightupoutside',
    onTap: 'ontap',
    onTouchCancel: 'ontouchcancel',
    onTouchEnd: 'ontouchend',
    onTouchEndOutside: 'ontouchendoutside',
    onTouchMove: 'ontouchmove',
    onTouchStart: 'ontouchstart',
    onWheel: 'onwheel',
});

/** The reverse table: a Pixi handler property name to the PascalCase prop that should be used instead. */
export const PIXI_TO_REACT_EVENT_PROP_NAMES: Readonly<Record<string, string>> = Object.freeze(
    Object.fromEntries(Object.entries(REACT_TO_PIXI_EVENT_PROP_NAMES).map(([react, pixi]) => [pixi, react])),
);

const has = (table: Readonly<Record<string, string>>, key: string) => Object.prototype.hasOwnProperty.call(table, key);

export function isReactEventProp(key: string): boolean
{
    return has(REACT_TO_PIXI_EVENT_PROP_NAMES, key);
}

export function isPixiEventProp(key: string): boolean
{
    return has(PIXI_TO_REACT_EVENT_PROP_NAMES, key);
}
