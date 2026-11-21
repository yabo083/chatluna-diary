# Security

## Reporting

Open a private security advisory or contact the maintainer through GitHub. Do not file a public issue for an unpatched vulnerability.

## Model boundary

`diary_read` action `context` returns a bounded digest of conversations. It is untrusted model input, not instructions. The system prompt and skill generator must continue to tell the model to treat it as data. Redaction removes links, keys, tokens and local addresses, but it is not a guarantee that a conversation contains no sensitive content.

## Tool boundary

Diary tools are limited to the owner's direct chat, an authenticated WebUI conversation, or a diary-scheduled run created by this plugin. Group members sharing the preset get `FORBIDDEN`; the WebUI token remains the page-level authority. A scheduled run sees only `diary_read` and `diary_write` (`list` included); `diary_manage` is not registered for it, so management is unreachable from scheduled prompts.

`diary_read` action `list` returns one bounded metadata page — dates, mark levels, entry titles and first lines, never bodies — with `before`/`limit` paging (default 30, max 100), the whole-book total, and oversized days marked skipped. In direct chat, `diary_manage` always exposes `export`, `format` and `delete` with no plugin config gate: `export` requires explicit dates chosen from `list` and fails explicitly over its output budget; `format` only adds a missing date header and normalizes line endings, locking one day at a time and skipping oversized days; batch `delete` verifies every named date under one book lock, writes the marks update first, then unlinks idempotently. Deletion is expected only on an explicit user request; WebUI export is capped at 16 MiB.

## Data

Diary files, marks and media live under the ChatLuna data directory. They are private to the deployment account. Day files and `marks.json` are capped at 1 MiB. A legacy day over the cap is unreadable to normal `read`/`export` and skipped by `format`, but can be replaced or deleted without reading it first; an oversized or damaged marks file is moved aside to a timestamped backup on repair. Restrict filesystem access and backups accordingly.

## Media

`diary_write` action `attach` accepts only real files under the agent workspace, with the documented image extensions and an 8 MB cap. `diary.media` is an authenticated WebUI action, not a public static route.

## Publishing

The npm publish workflow uses GitHub Actions OIDC and short-lived credentials; do not add a long-lived `NPM_TOKEN` to the repository. The first publish is manual so the package exists before trusted publishing is attached.
