import { type HostConfig } from '../typedefs/HostConfig';

/** What `applyProps` accepts and returns: any Pixi instance, typed as upstream's host instance. */
export type MaybeInstance = Partial<HostConfig['instance']>;
