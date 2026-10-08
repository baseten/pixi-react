import { createHash } from 'node:crypto';

export function resolvedPackagesFromLock(lock)
{
    return Object.fromEntries(Object.entries(lock.packages).filter(([path]) => path).map(([path, pkg]) => [path.replace(/^node_modules\//, ''), { version: pkg.version, integrity: pkg.integrity }]));
}

export function resolvedPackagesSha256(packages)
{
    // Sort full package paths, preserving scopes and nested node_modules segments.
    const canonical = Object.keys(packages).sort().map((name) => [name, packages[name].version, packages[name].integrity]);

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
