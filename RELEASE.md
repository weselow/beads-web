# Release Process

How to cut a release of **beads-web** and where the built binaries are
published. Most of the pipeline is automated by GitHub Actions; the manual parts
are called out explicitly.

## Overview

beads-web ships as a single self-contained binary per platform — the frontend is
embedded into the Rust binary via `rust-embed`. One tag push fans out to every
distribution channel.

| Channel | Where copies live | Updated by | One-time setup |
|---------|-------------------|-----------|----------------|
| GitHub Releases | `weselow/beads-web` → Releases | `release.yml` (automatic) | — |
| Scoop (Windows) | `bucket/beads-web.json` (this repo) | `release.yml` (automatic) | — |
| Nix (macOS/Linux/WSL) | `flake.nix` (this repo) | `ci.yml` refreshes deps hash; version is manual | — |
| Homebrew (macOS/Linux) | `Formula/beads-web.rb` in `weselow/homebrew-beads-web` | `release.yml` (automatic) | tap repo + `HOMEBREW_TAP_TOKEN` |
| winget (Windows) | `microsoft/winget-pkgs` | `release.yml` `winget` job via `wingetcreate` | first submission manual + `WINGET_TOKEN` |

## Cutting a release

### 1. Bump the version

The version lives in four files that are **not** auto-synced. Update all of
them to the new version (e.g. `0.12.0`):

- `package.json` → `"version"`
- `server/Cargo.toml` → `version`
- `server/Cargo.lock` → `version` in the `[[package]] name = "beads-server"` block
- `flake.nix` → **both** `version = "…"` lines (the frontend package and the default package)

> `Cargo.lock` is easy to miss and easy to get wrong. The Nix build reads it
> (`cargoLock.lockFile = ./server/Cargo.lock`), so a stale version there breaks
> `nix build` even though `cargo` itself would silently repair it. Do **not**
> blind-replace the old version string in that file — unrelated dependencies can
> sit at the same version number (at 0.11.2 the crate `zerovec-derive` did).
> Anchor on the `name = "beads-server"` line.

The package-manager manifests (Scoop, Homebrew, winget) are refreshed
automatically from the git tag — do **not** hand-edit them.

Commit the bump to `main`.

> Pushing to `main` triggers `ci.yml`, which may auto-commit a refreshed
> `npmDepsHash` into `flake.nix` if dependencies changed. Pull that commit before
> you tag.

### 2. Tag and push

```bash
git tag v0.12.0
git push origin v0.12.0
```

Or run the **Release** workflow manually: *Actions → Release → Run workflow*,
entering the version (e.g. `v0.12.0`).

### 3. What runs automatically

`.github/workflows/release.yml`:

1. **build** job — for each of macOS arm64, macOS x64, Linux x64, Windows x64:
   `npm ci` → `npm run build` (static export → `out/`) → `cargo build --release`
   → upload the binary as an artifact.
2. **release** job (Ubuntu):
   - downloads all four binaries,
   - generates `SHA256SUMS.txt`,
   - creates the GitHub Release (binaries + checksums + auto-generated notes),
   - refreshes the Scoop manifest (`bucket/beads-web.json`) and commits it to `main`,
   - renders the Homebrew formula from `packaging/homebrew/beads-web.rb.tmpl` and
     pushes it to the tap repo (skipped if `HOMEBREW_TAP_TOKEN` is unset).
3. **winget** job (Windows): downloads `wingetcreate` and runs
   `wingetcreate update weselow.beads-web` to open a version-bump PR against
   `microsoft/winget-pkgs` (skipped if `WINGET_TOKEN` is unset).

> **A red winget job does not mean a failed release.** `wingetcreate update`
> only works once the package exists in the catalog, so until the first
> submission PR is merged this job fails with
> `repos/microsoft/winget-pkgs/contents/manifests/w/weselow/beads-web was not
> found`. It runs after `release`, so the GitHub Release, Scoop, and Homebrew are
> already published by then and are unaffected. Nothing to fix — just don't
> re-run the release on account of it.

Separately, `.github/workflows/ci.yml` runs on every push to `main` and keeps the
Nix `npmDepsHash` current, auto-committing the refreshed hash when it drifts.

### 4. After the release

- Confirm the GitHub Release has all four binaries + `SHA256SUMS.txt`.
- Homebrew: `brew update && brew upgrade beads-web`.
- Scoop: `scoop update beads-web`.
- winget: the CI-opened PR in `microsoft/winget-pkgs` must pass Microsoft's
  validation and be merged (usually hours to a couple of days). You only sign the
  Microsoft CLA on the **first** PR.

## Required repository secrets

Set under *weselow/beads-web → Settings → Secrets and variables → Actions*:

| Secret | Purpose | How to create |
|--------|---------|---------------|
| `GITHUB_TOKEN` | built-in; release + Scoop/Nix commits | automatic |
| `HOMEBREW_TAP_TOKEN` | push the formula to `weselow/homebrew-beads-web` | fine-grained PAT, that repo only, **Contents: read/write** |
| `WINGET_TOKEN` | fork `microsoft/winget-pkgs` and open the winget PR | classic PAT, **`public_repo`** scope |

Both the Homebrew step and the winget job no-op cleanly when their token is absent.

## One-time setup (already completed)

- Tap repo `weselow/homebrew-beads-web` created and seeded with `Formula/beads-web.rb`.
- Secrets `HOMEBREW_TAP_TOKEN` and `WINGET_TOKEN` added.
- First winget submission opened against `microsoft/winget-pkgs` and the Microsoft
  CLA signed. Subsequent releases update winget automatically.

### Manual first winget submission (reference)

The CI `winget` job uses `wingetcreate update`, which only works once the package
already exists in the catalog. The very first submission is manual, from a machine
with the manifests checked out:

```bash
wingetcreate submit packaging/winget --token <WINGET_TOKEN>
```

This opens a PR to `microsoft/winget-pkgs`; sign the Microsoft CLA when the bot
asks (`@microsoft-github-policy-service agree`).

## Known gaps

- **No test/lint CI on push or PR.** Nothing runs `vitest`, `cargo test`,
  `clippy`, `tsc`, or `eslint` automatically, so a regression can merge — or ship
  in a release — undetected. Until that is added, run `npm run lint`,
  `npm run typecheck`, `npm run test`, and (in `server/`) `cargo test --lib`
  locally before tagging. On Windows `cargo test` (full) hangs because the
  `memory_bd` integration test starts Dolt — use `cargo test --lib`.
- **Version duplication.** The version is repeated in `package.json`,
  `server/Cargo.toml`, `server/Cargo.lock`, and `flake.nix` (twice) with no
  automated consistency check.
