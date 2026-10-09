/* eslint-disable @typescript-eslint/no-require-imports, global-require, no-console -- a CommonJS script run inside a consumer project; its output is the report. */
// Runs inside one clean consumer project (scripts/release/consumers.mjs) with that project's TypeScript. For each
// entry it resolves the published declarations twice under NodeNext, once as an ES module (`import` condition) and
// once as CommonJS (`require` condition), and checks that:
// - both resolve to declaration files inside the installed package (never a source path or a workspace alias);
// - both declare the same exports;
// - every runtime export (loaded with `require`) is declared as a value, and every declared value exists at runtime.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const scenario = JSON.parse(fs.readFileSync('scenario.json', 'utf8'));
const problems = [];
const notes = [];

function declaredExports(spec, extension)
{
    const probe = path.resolve(`.declarations-probe${extension}`);

    fs.writeFileSync(probe, `import * as M from '${spec}';\nexport { M };\n`);
    try
    {
        const program = ts.createProgram([probe], {
            module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext, target: ts.ScriptTarget.ES2022,
            strict: true, noEmit: true, skipLibCheck: true, types: [],
        });
        const checker = program.getTypeChecker();
        const source = program.getSourceFile(probe);
        const declaration = source.statements.find(ts.isImportDeclaration);
        const symbol = checker.getSymbolAtLocation(declaration.moduleSpecifier);

        if (!symbol) return { error: `${spec} does not resolve to declarations (${extension})` };
        const files = (symbol.declarations ?? []).map((node) => node.getSourceFile().fileName);
        const outside = files.filter((file) => !file.includes(`/node_modules/${spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/')}/`) || !(/\.d\.[cm]?ts$/).test(file));

        if (outside.length) return { error: `${spec} (${extension}) resolves outside its installed declarations: ${outside.join(', ')}` };
        // `export type { C }` of a class is a type-only alias: its target has a value, but the module exports none.
        const typeOnly = (item) => (item.declarations ?? []).some((node) => (ts.isExportSpecifier(node) && (node.isTypeOnly || node.parent.parent.isTypeOnly))
            || (ts.isImportSpecifier(node) && (node.isTypeOnly || node.parent.parent.isTypeOnly)));
        const exports = checker.getExportsOfModule(symbol).map((item) =>
        {
            const target = item.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(item) : item;

            return { name: item.name, value: !typeOnly(item) && Boolean(target.flags & ts.SymbolFlags.Value) };
        });

        return { exports, file: path.relative(process.cwd(), files[0]) };
    }
    finally
    {
        fs.rmSync(probe, { force: true });
    }
}

for (const spec of scenario.declarations ?? [])
{
    const esm = declaredExports(spec, '.mts');
    const cjs = declaredExports(spec, '.cts');

    for (const result of [esm, cjs]) if (result.error) problems.push(result.error);
    if (esm.error || cjs.error) continue;
    const names = (result) => result.exports.map((item) => item.name).sort().join(',');

    if (names(esm) !== names(cjs)) problems.push(`${spec}: import and require declarations differ:\n    import:  ${names(esm)}\n    require: ${names(cjs)}`);
    if (scenario.runtimeEntries?.includes(spec))
    {
        const runtime = Object.keys(require(require.resolve(spec, { paths: [process.cwd()] }))).filter((key) => key !== '__esModule' && key !== 'default');
        const values = esm.exports.filter((item) => item.value).map((item) => item.name);

        for (const key of runtime) if (!values.includes(key)) problems.push(`${spec}: runtime export ${key} has no value declaration`);
        for (const key of values) if (!runtime.includes(key)) problems.push(`${spec}: declared value ${key} is missing at runtime`);
    }
    notes.push(`${spec}: ${esm.exports.length} declared exports (${esm.exports.filter((item) => item.value).length} values); import -> ${esm.file}, require -> ${cjs.file}`);
}

if (problems.length)
{
    console.error(`declarations: FAILED\n  - ${problems.join('\n  - ')}`);
    process.exit(1);
}
console.log(`declarations: ok\n  ${notes.join('\n  ')}`);
