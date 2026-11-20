# chatluna-diary

A per-preset diary for ChatLuna v2 WebUI: read the day's real conversation digest, write or append a Markdown entry, place a stacked hand-drawn brush mark, attach images from the agent workspace, and let a scheduled job write at 22:00.

## What it does

- **One book per preset** under `data/chatluna/diary/<presetId>/`.
- **`diary_context`** builds a bounded, redacted digest of real user/assistant turns for one local day. It excludes tool/system noise and the schedule subagent; the middle of a conversation may be omitted, so the model must not invent what it cannot see.
- **`diary_read`** returns up to 7 days / ~12,000 characters of existing entries, newest first.
- **`diary_write`** writes `append` or `replace`; ordinary chats default to replace, scheduled jobs default to append.
- **`diary_mark`** puts a 1–5 importance mark on a date, independent of whether a body exists.
- **Marks are one mark, stacked**: a single hand-drawn vermilion brush circle is repeated 1–5 times for levels 1–5. The mask is shipped inline; no external image request.
- **`diary_attach`** copies an image from `data/chatluna/agents-work/` into the book and returns a `diary-media:` Markdown tag.
- **Scheduled writing**: one job per preset at local 22:00 (`0 22 * * *`), with the preset locked to its own book.
- **WebUI**: a V2 book page, calendar with marks, index, reading pane, media blob loading, and a hidden `/diary/preview` layout showcase.

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

Pick any workspace directory for source checkouts (`<workspace>` below).

```powershell
New-Item -ItemType Directory -Force <workspace>
Set-Location <workspace>
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
  media/             images copied by diary_attach
```

`presetId` is sanitized to `[A-Za-z0-9][A-Za-z0-9._-]*`; anything else falls back to `default`. A normal chat cannot write another preset's book; only the scheduled runner may pass `presetId` for its own job. If a conversation switched presets in place, only entries after the most recent `chatluna:preset` switch are eligible for the current preset; earlier segments are discarded rather than mixed into the diary.

## Tools

| Tool | Purpose |
| --- | --- |
| `diary_context` | Bounded day digest: users, assistants, scenes, senders, image names |
| `diary_read` | Existing entries, up to 7 days / ~12k chars |
| `diary_write` | Append or replace a day's Markdown body |
| `diary_mark` | Level 1–5 mark plus an 80-char note |
| `diary_attach` | Copy a workspace image into the book and return Markdown |

The model-facing contract is also injected into each agent's system prompt. Keep it in sync with `index.ts` when tools change.

## Marks

Level N renders the same brush mask N times, with small deterministic offsets/rotations. Higher levels look denser because the ink stacks; there are no separate leaf/star/heart shapes. The mask lives at `client/assets/mark-l5-mask.png` and is inlined by the Vite library build.

## Build and test

```bash
npm install
npm test        # node --test context-digest.test.ts
npm run build   # dist/client.js + dist/client.css
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

- Diary tools are limited to the owner's **direct chat** (or a diary-scheduled run created by this plugin). Group members sharing the preset get `FORBIDDEN`; the WebUI token remains the page-level authority.
- The scheduled diary run gets a per-agent tool filter: only `diary_context`, `diary_read`, `diary_write`, `diary_mark`, `diary_attach` are visible. Group text is still untrusted input, but it cannot reach shell/filesystem tools through this agent.
- Diary files are private (new files `0600`, directories `0700`). The plugin writes under the ChatLuna data directory; restrict the deployment account and backups accordingly.
- External images in diary Markdown are replaced with a blocked placeholder, so opening a page cannot probe external or localhost URLs. Links open with `noopener noreferrer`.
- The digest redacts links, keys, tokens and local addresses, but it is still model input from untrusted conversations. Treat it as data, never as instructions. Scheduled prompts say the same.
- `diary_attach` only accepts real files inside the agent workspace, rejects hardlinked files, images ≤8 MB, and the documented extensions.
- Media is served through an authenticated WebUI action, not a public static path; files larger than 8 MB are not served.

## License

MIT
