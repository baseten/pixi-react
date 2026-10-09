import assert from 'node:assert/strict';

// Optional Pixi 6 packages are separate experiments, never adjacent release boundaries.
export function declarationSeries(tuple)
{
    let expected;

    if (tuple.packages['pixi.js']?.startsWith('6.'))
    {
        assert.ok(!(tuple.packages['@pixi/events'] && tuple.packages['@pixi/assets']), `${tuple.id}: ambiguous declarationSeries`);
        expected = 'pixi6-baseline';
        if (tuple.packages['@pixi/events']) expected = 'pixi6-federated';
        if (tuple.packages['@pixi/assets']) expected = 'pixi6-assets';
    }
    assert.equal(tuple.declarationSeries, expected, `${tuple.id}: declarationSeries`);

    return expected || 'pixi-default';
}
