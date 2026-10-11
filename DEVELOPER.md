# My Tracker — Developer Guide

## 1. Project Status

**Current release:** 0.1.2

My Tracker is an Obsidian plugin for activity tracking, productivity analysis, and dashboard-based review.

Version 0.1.2 includes the Advanced dashboard redesign. Release metadata and the changelog should remain consistent with the version being developed.

This guide describes development practices and the documented project structure. Verify implementation details against the current source code before relying on them.

## 2. Development Setup

### Requirements

- Node.js and npm
- Git
- Obsidian for manual plugin testing

### Install dependencies

```bash
npm install
```

Installs the dependencies declared by the project.

### Run tests

```bash
npm test
```

Runs the test suite configured in `package.json`. Record the actual result rather than relying on a historical test count.

### Check TypeScript

```bash
npm run typecheck
```

Runs the configured TypeScript checks.

### Start development mode

```bash
npm run dev
```

Runs the development script defined by the project.

### Build the plugin

```bash
npm run build
```

Runs the configured production build.

Before using these commands, verify that the corresponding scripts exist in `package.json`.

## 3. Architecture

The documented architecture separates reusable core logic, external integrations, UI components, and Obsidian-specific plugin wiring.

### `src/core/`

Contains reusable application logic. Core modules should avoid importing Obsidian APIs directly.

Documented responsibilities include:

- Duration and date handling
- Text parsing and hierarchy
- Query matching
- Statistics and comparisons
- Targets and performance analysis
- Metrics and data integrity
- Migration and storage
- Import, export, backup, and reporting
- Defaults and settings
- Widget configuration and colors

Check the current source tree before assuming a particular module exists.

### `src/integrations/`

The documented integration layer includes:

- `activitywatch.ts` — ActivityWatch integration
- `obsidianIO.ts` — Obsidian-related input/output

Verify external integrations against their actual interfaces. Mocked tests do not prove that a real service works correctly.

### `src/ui/`

Contains the documented dashboard and interface components, including charts, layout editing, tracking modals, drill-down views, settings, setup, and other UI interactions.

Test affected UI behavior inside Obsidian. Successful type checking alone does not establish that the interface works correctly.

### `src/main.ts`

The plugin entry point connects core logic, integrations, commands, UI components, and the Obsidian lifecycle.

Keep reusable application logic separate from Obsidian-specific wiring where the existing architecture permits it.

## 4. Data Safety

### Operation log

The documented design uses an append-only operation log. Preserve the intended history of changes and avoid silently rewriting existing records.

Inspect the current implementation before changing storage behavior.

### Schema migrations

Changes to persistent data structures may require a migration.

Before changing the schema:

1. Inspect the existing data model and migration code.
2. Define how existing user data will be handled.
3. Make migrations safe for existing vaults.
4. Test relevant success and failure cases.
5. Confirm that data is preserved when the plugin is reopened.

Do not assume a migration is unnecessary merely because the project compiles.

### Analytics and parsing

Changes to parsing, statistics, targets, or performance calculations may affect dashboard results. Add or update tests for relevant edge cases and preserve existing behavior unless the change intentionally modifies it.

### Dashboard widgets

Dashboard changes should preserve valid configuration, layout behavior, and tracking data. Test customization, rendering, and interactions inside Obsidian.

## 5. Testing and Quality Checks

Before completing a code change, run:

```bash
npm test
npm run typecheck
npm run build
git diff --check
```

These commands run the configured tests, check TypeScript, build the plugin, and check the Git diff for whitespace errors.

Investigate failures rather than treating the change as complete.

### Manual verification

After a successful build:

1. Install the generated plugin files in a separate test vault.
2. Enable My Tracker in Obsidian.
3. Check for relevant console errors.
4. Test the changed feature and related existing workflows.
5. Verify that stored data remains intact after restarting Obsidian.

### Integration verification

Clearly distinguish between mocked tests and tests against a real external service. Record which environment was tested and what was actually verified.

### UI verification

Core unit tests do not prove that Obsidian views, modals, keyboard interactions, or dashboard layouts work correctly. Manually test affected UI components.

## 6. Issues and Roadmap

Earlier development notes identified areas for verification, including dashboard and modal layout, mobile storage behavior, ActivityWatch requests, autocomplete, and focus after dashboard rerendering.

These are historical verification candidates, not confirmed current bugs. Reproduce an issue before reporting it as active, and remove resolved issues from the active issue list.

Earlier roadmap proposals included:

- Per-device log files
- Start and stop tracking sessions
- Calendar heatmaps
- Required-pace forecasts
- Grade-trend charts
- Data-health commands
- Persistent revert and history
- Daily-note integration
- Subject merging
- Toggl and Clockify integrations
- ICS importers
- A UI testing harness

These are proposals, not promises or claims about current implementation. Check the source code and issue tracker before treating an item as unfinished.

Prioritize data safety, correctness, and reproducible bugs before adding features.

## 7. Git Workflow

Before making changes:

```bash
git status
git branch --show-current
```

These commands show the working-tree state and the current branch.

Review changes before committing:

```bash
git diff
git diff --check
```

The first command displays unstaged changes. The second checks for whitespace errors.

Do not overwrite unrelated user changes. Do not commit, push, or publish a release without explicit authorization.

## 8. Release Procedure

Before preparing a release:

1. Confirm the intended version number.
2. Run tests, type checking, and the production build.
3. Test the built plugin inside Obsidian.
4. Update `manifest.json` and `package.json` consistently.
5. Update `versions.json` with the correct minimum Obsidian version.
6. Update `CHANGELOG.md` with changes actually included in the release.
7. Review the complete diff and exclude unrelated changes.
8. Create release tags and publish the release only when authorized.
9. Verify the published release assets and version.

Typical Obsidian plugin release assets include `main.js`, `manifest.json`, and `styles.css` when the project uses that stylesheet. Confirm the actual build outputs before attaching assets.

A successful local build does not prove that a GitHub release was published correctly.

## 9. Documentation Maintenance

Keep this guide synchronized with the repository.

- Use the current release version.
- Never invent test counts or verification results.
- Distinguish confirmed bugs from items requiring investigation.
- Label proposed features as roadmap items.
- Keep setup instructions consistent with `package.json`.
- Verify release metadata and changelog entries before publishing.

**Development principle:** inspect the current code, run the relevant checks, and verify behavior before claiming a feature works.
