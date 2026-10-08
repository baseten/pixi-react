import { createHash } from 'node:crypto';

export function surfaceMapSha256(surfaces)
{
    const canonical = Object.keys(surfaces).sort().map((path) => [path, surfaces[path].sha256, surfaces[path].declarations ?? null]);

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
