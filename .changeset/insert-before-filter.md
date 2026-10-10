---
"@pixi/react": patch
"@pixi-react-provisional/pixi-8": patch
---

Fix insertions next to a filter element. A display node that React inserted before a filter sibling (for example a new `<pixiContainer />` rendered ahead of a `<pixiBlurFilter />`) threw "The supplied Container must be a child of the caller", because filters join the parent's `filters` instead of its children. A filter inserted before a display node, or a particle inserted before a filter in a ParticleContainer, went last instead of at its JSX position. The adapter now records each parent's JSX child order and places the node before the next sibling of its own kind, or last.
