# Source bootstrap for Windows

```powershell
# Run from the package root, e.g. <workspace>\chatluna-diary
Set-ExecutionPolicy -Scope Process Bypass
.\scripts\windows-bootstrap.ps1 -SourceRoot (Get-Location).Path
```

The script initializes git, creates/pushes the GitHub repo with `gh`, runs tests/build, and prints the npm/OIDC steps. It never stores an npm token.
