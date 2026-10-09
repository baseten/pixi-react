#!/usr/bin/env node
/* eslint-disable no-console -- command-line script. */
/**
 * `prepublishOnly` guard (issue 15). npm and pnpm run it before `publish`, including the `npm publish` that
 * `changeset publish` and semantic-release invoke. It fails unless release.packages.json enables publishing and
 * names a registry, so no command in this repository can publish until the owner configures a destination.
 * The modular packages are additionally `"private": true`, which npm refuses to publish even without scripts.
 */
import { loadReleaseConfig } from './config.mjs';

const config = loadReleaseConfig();

if (!config.publishEnabled)
{
    console.error(`Publishing is disabled: ${config.raw.publish.reason}\nSet "publish.enabled" and "publish.registry" in release.packages.json through an owner-reviewed change first (design/release.md).`);
    process.exit(1);
}
console.log(`publish guard: enabled for ${config.raw.publish.registry} (namespace ${config.namespace})`);
