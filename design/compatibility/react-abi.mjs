import { createHash } from 'node:crypto';

export function reactAbiSha256(observation)
{
    const canonical = [observation.hostKeys.toSorted(), observation.exports.toSorted()];

    return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}
