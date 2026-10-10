# Changesets

The publishable packages release in lockstep: `config.json` puts them in one `fixed` group, so every release moves all
of them to the facade's version, at the highest bump of the pending changesets (issue 62). Add a changeset with
`pnpm changeset` for every change a consumer can observe; the release policy is in
[design/release.md](../design/release.md).

- A change to the adapter ABI (`CORE_ABI`, or an adapter manifest's `abi`) needs a changeset of at least minor level
  whose summary says `ABI`, so the changelog tells users; `pnpm release:policy` enforces it.
- Run `pnpm release:version`, not `changeset version` alone: it also checks the ABI policy, updates the version
  constants the adapter manifests report, and records the released ABI.
- Never-published workspace packages (docs, examples, conformance, type-consumers, react-shared, design-contract
  and the fixtures) are ignored here; see `release.packages.json`.
- Nothing is published from this repository until the owner enables it in `release.packages.json`.
