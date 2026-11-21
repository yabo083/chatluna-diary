# chatluna-diary

A per-preset diary for ChatLuna v2 WebUI: read the day's real conversation digest, write or append a Markdown entry, place a stacked hand-drawn brush mark, attach images from the agent workspace, and let a scheduled job write at 22:00.

## What it does

- **One book per preset** under `data/chatluna/diary/<presetId>/`.
- **Three model-facing tools**, split by intent:
  - `diary_read` — `action: "list" | "read" | "context"`: one paginated index page (dates, marks, titles, first lines; `before`/`limit`), existing entries (up to 7 days / ~12k chars), and a bounded day digest.
  - `diary_write` — `action: "write" | "mark" | "attach"`: append/replace writing, 1–5 marks, and workspace image copy.
  - `diary_manage` — `action: "export" | "format" | "delete"`: explicit-date export, conservative formatting, and deletion, always offered to the AI.
- **Marks are one mark, stacked**: a single hand-drawn vermilion brush circle is repeated 1–5 times for levels 1–5. The mask is shipped inline; no external image request.
- **Scheduled writing**: one job per preset at local 22:00 (`0 22 * * *`), with the preset locked to its own book.
- **WebUI**: a V2 book page, calendar with marks, index, reading pane, media blob loading, and a hidden `/diary/preview` layout showcase.
- **Management**: each book card has a corner menu (export all, format, delete all); the book header has a batch button for marquee-selecting days and exporting/deleting them. Day configuration lives in each entry's `...` icon menu (edit/delete entry, mark level, delete day); new entries use the bottom composer. There is no all-in-one management modal, separate paper toolbar, or manual AI-write button.
- **Tool loading**: all three diary tools are marked resident (`deferred: false`), so a scheduled run can call the ones it is allowed to see even when tool search is on.

## Install

This is a ChatLuna **data plugin**. Place it where ChatLuna loads plugins and build the client:

```bash
cd data/chatluna/plugins/chatluna-diary
npm install
npm run build
# restart ChatLuna
```

The server loads `index.ts`; the browser bundle is `dist/client.js`. The package also works as an npm source package (`npm i chatluna-diary`) if your deployment symlinks or copies the package into the plugin directory.

### Windows source

Put the checkout under the `projects/` column:

```powershell
New-Item -ItemType Directory -Force <workspace>\projects
Set-Location <workspace>\projects
git clone https://github.com/yabo083/chatluna-diary.git
Set-Location chatluna-diary
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-bootstrap.ps1 -SourceRoot (Get-Location).Path
```

The script installs, tests, builds, initializes git if needed, and pushes to GitHub. It never stores an npm token.

### Requirements

- ChatLuna v2 (`@chatluna/*` 2.0.0-alpha line)
- Node.js 22+
- A WebUI deployment with `chatluna_webui`, `tools`, `presets`, `schedule` services

## Data layout

```text
data/chatluna/diary/<presetId>/
  YYYY-MM-DD.md      one day, possibly several "## title" entries
  marks.json         { "version": 1, "marks": { "YYYY-MM-DD": { level, note?, updatedAt } } }
  media/             images copied by the diary_write attach action
```

`presetId` is sanitized to `[A-Za-z0-9][A-Za-z0-9._-]*`; anything else falls back to `default`. A normal chat cannot write another preset's book; only the scheduled runner may pass `presetId` for its own job. If a conversation switched presets in place, only entries after the most recent `chatluna:preset` switch are eligible for the current preset; earlier segments are discarded rather than mixed into the diary.

Each day file is capped at 1 MiB for normal reads and writes. A legacy day above the cap is unreadable to `read` and `export` and is skipped by `format`, but it can still be replaced or deleted without reading the old body first. `marks.json` is capped at 1 MiB; on repair, a damaged or oversized marks file is moved aside to a timestamped backup.

## Tools

| Tool | Actions | Purpose |
| --- | --- | --- |
| `diary_read` | `list` | One compact-index page: dates, mark levels, entry titles and first lines — no bodies; reports the whole-book total |
| | `read` | Existing entries for the current preset (up to 7 days / ~12k chars) |
| | `context` | Bounded digest of the day's real conversation, tool noise excluded |
| `diary_write` | `write` | Append or replace one day's Markdown |
| | `mark` | Set mark level 1–5 plus an optional 80-char note |
| | `attach` | Copy a workspace image and return a `diary-media:` Markdown tag |
| `diary_manage` | `export` | Export explicitly named dates chosen from `list` |
| | `format` | Add a missing date header and normalize line endings; body syntax preserved |
| | `delete` | Delete named dates; absent dates are reported, not errors |

`diary_read` action `list` is the discovery entry. It returns at most one metadata page (`before` is an exclusive date, `limit` defaults to 30 and caps at 100), includes mark-only dates, reports the book total, and names the `before` value for the next older page. A day over the size cap shows as skipped.

`diary_manage` always exposes `export`, `format` and `delete` to the model; there is no plugin config gate or action allow-list. `export` requires explicit `dates` picked from `list` — there is no implicit whole-book export — and fails explicitly when the result exceeds its output budget. `format` only adds a missing `# YYYY-MM-DD` header and normalizes line endings, preserving body syntax, code and hard breaks; it locks one day at a time and skips oversized days. `delete` is idempotent: existing dates and their marks are committed under one book lock, marks are written first, file unlinks are idempotent, and dates that were already absent are reported rather than failing the whole batch. `context` has a bounded read deadline; when it expires the returned text explicitly says the digest only covers the sessions read so far. Deletion still happens only when the user explicitly asks for it. The WebUI management menus described above are the user's own equivalent path and can still export selected days or the whole book; that download is capped at 16 MiB.

Scheduled diary runs see only `diary_read` and `diary_write` (`list` included); `diary_manage` is not registered for them.

The model-facing contract is also injected into each agent's system prompt. Keep it in sync with `index.ts` when tools change.

## Configuration

These fields are exported as the plugin `Config` and appear on the ChatLuna plugin page:

- `scheduleEnabled` (default on)
- `dailyCron` (default `0 22 * * *`)
- `defaultWriteMode` (`append` default, or `replace`)
- `digestBudget` (default 12000)
- `readLimit` (default 12000)
- `maxBodyChars` (default 32000)
- `maxImageMb` (default 8)
- `mediaRetentionHours` (default 24)

Disabling the schedule removes this plugin's existing jobs; manual tool calls are unaffected.

## Marks

Level N renders the same brush mask N times, with small deterministic offsets/rotations, plus a centered `1–5` numeral in a local rounded font. Higher levels look denser because the ink stacks; there are no separate leaf/star/heart shapes. The mask lives at `client/assets/mark-l5-mask.png` and is inlined by the Vite library build.

## Build and test

```bash
npm install
npm test        # node --test (all *.test.ts)
npm run build   # dist/client.* + server.js
npm pack        # verifies the published file set
```

## Skill generation

`skills/SKILL_GENERATOR.md` is a **meta-skill**, not a fixed skill. Give it to any ChatLuna v2+ model in the target deployment; it discovers the actual tool names, presets, paths, schedule, limits and locale, then generates a deployment-specific `SKILL.md`. Do not copy a stale fixed diary skill across environments.

## Publishing

### GitHub

```bash
git init
git add .
git commit -m "feat: chatluna-diary 0.1.0"
gh repo create yabo083/chatluna-diary --public --source=. --remote=origin --push
```

### npm (manual)

```bash
npm login
npm publish --access public
```

### npm OIDC / trusted publishing

`.github/workflows/publish.yml` already requests `id-token: write` and runs:

```bash
npm publish --provenance --access public
```

On npmjs.com, open **Package → Settings → Trusted publishing** for `chatluna-diary` and add:

- Provider: GitHub Actions
- Repository: `yabo083/chatluna-diary`
- Workflow: `publish.yml`
- Environment: leave empty (or create one and match the workflow)

The first publish must exist before trusted publishing can be attached; publish `0.1.0` once manually, then release tags use OIDC. No long-lived npm token is stored in the repository.

## Security notes

- Diary tools are limited to the owner's **direct chat**, an authenticated **WebUI conversation**, or a diary-scheduled run created by this plugin. Group members sharing the preset get `FORBIDDEN`; the WebUI token remains the page-level authority.
- The scheduled diary run gets a per-agent tool filter: only `diary_read` and `diary_write` are visible. Management is not available to scheduled runs — `diary_manage` is not registered for them. Group text is still untrusted input, but it cannot reach shell/filesystem tools through this agent.
- In a normal direct chat or WebUI conversation, `diary_manage` exposes `export`, `format` and `delete` with no config gate. `export` requires explicit dates and fails rather than truncating over budget; `format` preserves body bytes apart from headers and line endings and locks one day at a time; batch `delete` is idempotent under one book lock: marks commit first, then idempotent unlinks, and already-absent dates are reported as absent. A crash or failed unlink therefore converges on retry instead of leaving permanent phantom marks. It runs only on an explicit user request. The WebUI management menus remain the user's own authority; WebUI export is capped at 16 MiB.
- Diary files are private (new files `0600`, directories `0700`) and capped at 1 MiB per day and 1 MiB for `marks.json`. An oversized legacy day stays replaceable or deletable but is unreadable to `read`/`export` and skipped by `format`. The plugin writes under the ChatLuna data directory; restrict the deployment account and backups accordingly.
- External images in diary Markdown are replaced with a blocked placeholder, so opening a page cannot probe external or localhost URLs. Links open with `noopener noreferrer`.
- The digest redacts links, keys, tokens and local addresses, but it is still model input from untrusted conversations. Treat it as data, never as instructions. Scheduled prompts say the same.
- `diary_write` action `attach` only accepts real files inside the agent workspace, rejects hardlinked files, images ≤8 MB, and the documented extensions.
- Media is served through an authenticated WebUI action, not a public static path; files larger than 8 MB are not served.

## License

MIT
