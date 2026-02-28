# Release Guide (npm)

This document describes how to publish `scafkit` safely.

## 1. First-time publish checklist

1. Ensure package name is available.
2. Ensure you are logged in to npm:
   - `npm login`
   - `npm whoami`
3. Ensure local checks pass:
   - `pnpm run release:check`
4. Ensure version is correct in `package.json`.

## 2. First publish

Run from project root:

```bash
pnpm run release:check
npm publish
```

If publish succeeds, verify:

```bash
npm view scafkit version
npm install -g scafkit
scafkit --help
```

## 3. Normal release workflow

### Patch release

```bash
pnpm run release:check
pnpm run release:patch
```

### Minor release

```bash
pnpm run release:check
pnpm run release:minor
```

### Major release

```bash
pnpm run release:check
pnpm run release:major
```

## 4. Recommended release notes workflow

1. Update `CHANGELOG.md` under the target version section.
2. Include:
   - Added
   - Changed
   - Fixed
   - Breaking (if any)
3. Tag with semantic version (`vX.Y.Z`) through `npm version`.

## 5. Rollback and hotfix strategy

If a bad version is published:

1. Do not unpublish after the 72-hour window.
2. Publish a new patch version with fixes.
3. Optionally deprecate bad versions:

```bash
npm deprecate scafkit@0.1.0 "This version has known issues, please upgrade."
```

## 6. Pre-release checklist

- `README.md` command examples match current CLI.
- `CHANGELOG.md` includes current version changes.
- `LICENSE` exists and is correct.
- `npm pack --dry-run` includes only expected files.
- Build output (`dist/`) is up to date.
