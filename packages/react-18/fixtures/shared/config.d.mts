import type { UserWorkspaceConfig } from 'vitest/config';

export const PIXI_CELLS: readonly { readonly version: string; readonly module: string }[];
export function fixtureWorkspace(fixtureDir: string): UserWorkspaceConfig[];
