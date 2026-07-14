# Packaging

This directory holds the package-manager sources used to distribute `beads-web`.
Nothing here is built into the binary — these files feed the release automation in
[`.github/workflows/release.yml`](../.github/workflows/release.yml).

## `homebrew/`

- `beads-web.rb.tmpl` — Homebrew formula template with `__VERSION__`, `__ARM_SHA__`,
  `__INTEL_SHA__`, and `__LINUX_SHA__` placeholders.
- `beads-web.rb` — a rendered copy of the template (bootstrap for v0.11.2 with real
  hashes). Use it to seed the tap repo the first time.

On each release the `Update Homebrew formula` step renders the template with the new
version and freshly computed SHA-256 hashes and pushes the result to
`weselow/homebrew-beads-web` as `Formula/beads-web.rb`. Users then install with:

```
brew install weselow/beads-web/beads-web
```

## `winget/`

The three winget manifests (`version`, `installer`, `locale.en-US`) describe the
Windows portable package `weselow.beads-web`. On each release the `winget` job runs
`wingetcreate update` to submit a new version PR to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs).

`wingetcreate update` only works after the package already exists in winget-pkgs, so
the **first** submission is a one-time manual step:

```
wingetcreate submit packaging/winget --token <PAT>
```

## Required repo secrets

- `HOMEBREW_TAP_TOKEN` — a personal access token with push rights to
  `weselow/homebrew-beads-web`. When absent, the Homebrew step no-ops.
- `WINGET_TOKEN` — a personal access token used by `wingetcreate` to open the
  winget-pkgs PR. When absent, the winget job no-ops.
