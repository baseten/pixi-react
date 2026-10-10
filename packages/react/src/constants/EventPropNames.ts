export const ReactToPixiEventPropNames = Object.freeze({
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

/** A table with its keys and values swapped, typed literally. */
type Inverted<T extends Readonly<Record<string, string>>> = { readonly [K in keyof T as T[K]]: K };

/**
 * The reverse of `ReactToPixiEventPropNames`: each Pixi handler property to its PascalCase React prop. Derived, not
 * written out a second time (issue 58); the declared type is the same literal table as upstream's.
 */
export const PixiToReactEventPropNames = Object.freeze(Object.fromEntries(
    Object.entries(ReactToPixiEventPropNames).map(([react, pixi]) => [pixi, react]),
)) as Inverted<typeof ReactToPixiEventPropNames>;
