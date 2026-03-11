---
title: Release guide
description: "End-to-end release workflow: npm version commands, preversion/version/postversion lifecycle, GitHub Action build, wiki publishing, and rollback procedures."
author: "\U0001F916 Generated with Claude Code"
last updated: 2026-03-11
---
# Release guide

> **Warning**
>
> Source of truth: `plugins/knowledge/release-guide.md`. Copied to each plugin's `docs/` during `npm version` via `version-bump.mjs`. Edit the source, not the copy.

## Commands

Stage all source changes:

```bash
git add -A && git commit -m "new release"
```

Bump the version and push everything — source commit, version bump commit, and tag — to GitHub in one go:

```shell
npm version patch
```

```shell
npm version minor
```

```shell
npm version major
```

## What happens under the hood

### Step 1: `preversion` script validates

```json
"preversion": "node version-bump.mjs --preflight"
```

Runs eslint (including `no-console` check for ungated `console.debug`) and auto-updates `eslint-plugin-obsidianmd` if outdated. If anything fails, npm aborts **before touching `package.json`** — no dirty state to clean up.

### Step 2: npm bumps `package.json`

npm updates the `version` field in `package.json` (only runs if preversion succeeded).

### Step 3: `version` script runs

```json
"version": "node version-bump.mjs && git add manifest.json"
```

`version-bump.mjs` (without `--preflight`) re-validates, then:
- **Pulls latest README** from `origin/main` (so the release ships the GitHub-edited version).
- **Syncs version to `manifest.json`** to match `package.json`.

Then `manifest.json` is staged alongside `package.json`. The `git checkout` also auto-stages `README.md`, so the version commit includes all three files.

### Step 4: npm auto-commits and tags

npm creates a commit and a matching git tag (e.g. `0.8.1`). No `v` prefix — `.npmrc` sets `tag-version-prefix=""`.

### Step 5: `postversion` script pushes

```json
"postversion": "git push origin main --follow-tags --force-with-lease"
```

Pushes the commit and tag to GitHub in one go.

### Step 6: GitHub Action builds the release

The tag push triggers `.github/workflows/release.yml`:

1. **Checkout** → **install** (`npm ci`) → **build** (`npm run build`).
2. **Commits build output** (`main.js`, `manifest.json`) back to `main`.
3. **Bundles** `main.js`, `manifest.json`, `styles.css` into a zip.
4. **Generates release notes** from merged PRs and closed issues since the previous tag.
5. **Creates a GitHub Release** with the bundle and individual files attached.

## Updating wiki pages

Wiki pages live in a separate Git repo (`{plugin-name}.wiki.git`), not in the main source repo. The local clone is at `wiki/`.

```bash
cd wiki/
git add -A && git commit -m "Update wiki" && git push
```

Wiki changes are independent from releases — push them anytime.

## If something goes wrong

Delete the local tag, undo the version bump commit, and restore the files it changed:

```bash
git tag -d 0.9.0
git reset --soft HEAD~1
git restore --staged --worktree package.json manifest.json README.md package-lock.json
```

`--soft` leaves the version bump changes staged. The `restore` command reverts them so `npm version` can run cleanly on the original state.

If already pushed, also revert the remote changes:

```bash
git push origin :refs/tags/0.9.0        # deletes the remote tag (stops the GitHub Action if not yet triggered)
git push origin main --force             # reverts the version bump commit on main
```

If the GitHub Action already ran, delete the Release manually on GitHub, then force-push again to remove the build commit.
