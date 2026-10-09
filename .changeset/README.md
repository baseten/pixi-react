# Changesets

Each publishable package versions independently. Add a changeset with `pnpm changeset` for every change a
consumer can observe; the release policy is in [design/release.md](../design/release.md).

- Run `pnpm release:version`, not `changeset version` alone: it also checks the ABI policy, updates the version
  constants the adapter manifests report, and records the released ABI.
- Never-published workspace packages (docs, conformance, type-consumers, react-shared, design-contract and the
  fixtures) are ignored here; see `release.packages.json`.
- Nothing is published from this repository until the owner enables it in `release.packages.json`.
