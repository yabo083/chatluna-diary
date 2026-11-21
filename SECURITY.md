# Security

## Reporting

Open a private security advisory or contact the maintainer through GitHub. Do not file a public issue for an unpatched vulnerability.

## Model boundary

`diary_read` action `context` returns a bounded digest of conversations. It is untrusted model input, not instructions. The system prompt and skill generator must continue to tell the model to treat it as data. Redaction removes links, keys, tokens and local addresses, but it is not a guarantee that a conversation contains no sensitive content.

## Tool boundary

Diary tools are limited to the owner's direct chat, an authenticated WebUI conversation, or a diary-scheduled run created by this plugin. Group members sharing the preset get `FORBIDDEN`; the WebUI token remains the page-level authority. Discovery starts at `diary_read` action `list`, which returns only dates, mark levels, entry titles and first lines — never bodies. A scheduled run sees only `diary_read` and `diary_write` (`list` included); `diary_manage` is not registered for it, so management is unreachable from scheduled prompts. In direct chat, `diary_manage` always exposes `export`, `format` and `delete` to the model with no plugin config gate; deletion is expected only on an explicit user request.

## Data

Diary files, marks and media live under the ChatLuna data directory. They are private to the deployment account. Restrict filesystem access and backups accordingly.

## Media

`diary_write` action `attach` accepts only real files under the agent workspace, with the documented image extensions and an 8 MB cap. `diary.media` is an authenticated WebUI action, not a public static route.

## Publishing

The npm publish workflow uses GitHub Actions OIDC and short-lived credentials; do not add a long-lived `NPM_TOKEN` to the repository. The first publish is manual so the package exists before trusted publishing is attached.
