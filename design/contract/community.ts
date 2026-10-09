import { ReactAdapter, type Bind, type ReactBindingFamily, type Runtime, type PixiTypes, type AdapterManifest } from './core.js';
import { createRenderer } from './renderer.js';
import type { PixiAdapter } from './core.js';
interface Inspection<S extends PixiTypes> { inspect(): S['app']; node: S['node'] }
interface InspectionFamily extends ReactBindingFamily { readonly type: Inspection<Extract<this['pixi'], PixiTypes>> }
// An external React adapter adds its own public API without a known-adapter union.
declare class Inspector extends ReactAdapter<InspectionFamily> {
    readonly manifest: AdapterManifest;
    bind<S extends PixiTypes>(runtime: Runtime<S>): Bind<InspectionFamily, S>;
}
interface CommunityPixiTypes extends PixiTypes {
    readonly app: { label: string };
    readonly node: { particleIndex: number };
}
declare const community: PixiAdapter<CommunityPixiTypes>;
const inspector = createRenderer({ react: new Inspector(), pixi: community });
export const label: string = inspector.inspect().label;
export const particleIndex: number = inspector.node.particleIndex;
// @ts-expect-error A non-Container node has no invented addChild operation.
inspector.node.addChild({});
// @ts-expect-error A community binding does not acquire React hooks from the factory.
inspector.useApplication();
