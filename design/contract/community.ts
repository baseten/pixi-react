import { FrameworkAdapter, type Bind, type BindingFamily, type Runtime, type SceneTypes, type AdapterManifest } from './core.js';
import { createRenderer } from './renderer.js';
import type { SceneAdapter } from './core.js';
interface Inspection<S extends SceneTypes> { inspect(): S['app']; node: S['node'] }
interface InspectionFamily extends BindingFamily { readonly type: Inspection<Extract<this['scene'], SceneTypes>> }
// An external framework adds its own public API without a known-adapter union.
declare class Inspector extends FrameworkAdapter<InspectionFamily> {
    readonly manifest: AdapterManifest;
    bind<S extends SceneTypes>(runtime: Runtime<S>): Bind<InspectionFamily, S>;
}
interface CommunityScene extends SceneTypes {
    readonly app: { label: string };
    readonly node: { particleIndex: number };
}
declare const community: SceneAdapter<CommunityScene>;
const inspector = createRenderer({ react: new Inspector(), pixi: community });
export const label: string = inspector.inspect().label;
export const particleIndex: number = inspector.node.particleIndex;
// @ts-expect-error A non-Container node has no invented addChild operation.
inspector.node.addChild({});
// @ts-expect-error A community binding does not acquire React hooks from the factory.
inspector.useApplication();
