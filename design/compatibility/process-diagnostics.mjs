import { createHash } from 'node:crypto';

export function processDiagnosticsSha256(result)
{
    const canonical = [result.status, result.signal, result.error ?? null, result.stdout, result.stderr];

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
