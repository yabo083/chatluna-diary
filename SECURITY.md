# Security

## Reporting

Open a private security advisory or contact the maintainer through GitHub. Do not file a public issue for an unpatched vulnerability.

## Model boundary

`diary_context` returns a bounded digest of conversations. It is untrusted model input, not instructions. The system prompt and skill generator must continue to tell the model to treat it as data. Redaction removes links, keys, tokens and local addresses, but it is not a guarantee that a conversation contains no sensitive content.

## Data

Diary files, marks and media live under the ChatLuna data directory. They are private to the deployment account. Restrict filesystem access and backups accordingly.

## Media

`diary_attach` accepts only real files under the agent workspace, with the documented image extensions and an 8 MB cap. `diary.media` is an authenticated WebUI action, not a public static route.

## Publishing

The npm publish workflow uses GitHub Actions OIDC and short-lived credentials; do not add a long-lived `NPM_TOKEN` to the repository. The first publish is manual so the package exists before trusted publishing is attached.
