param(
  [string]$GitHubRepo = "yabo083/chatluna-diary",
  [string]$SourceRoot = (Get-Location).Path,
  [string]$CommitMessage = "feat: chatluna-diary 0.1.0"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $SourceRoot)) {
  throw "Source root not found: $SourceRoot. Extract the package there first."
}

Set-Location -LiteralPath $SourceRoot

Write-Host "==> Installing dependencies" -ForegroundColor Cyan
npm install --no-audit --no-fund

Write-Host "==> Running tests" -ForegroundColor Cyan
npm test

Write-Host "==> Building client" -ForegroundColor Cyan
npm run build

if (-not (Test-Path -LiteralPath ".git")) {
  Write-Host "==> Initializing git" -ForegroundColor Cyan
  git init
  git add .
  git commit -m $CommitMessage
}

Write-Host "==> Checking GitHub CLI" -ForegroundColor Cyan
gh auth status

$repoExists = $false
try {
  gh repo view $GitHubRepo --json name 2>$null | Out-Null
  $repoExists = $true
} catch {
  $repoExists = $false
}

if ($repoExists) {
  Write-Host "==> Repo exists; ensuring origin and pushing" -ForegroundColor Cyan
  git remote remove origin 2>$null
  git remote add origin "https://github.com/$GitHubRepo.git"
  git branch -M main
  git push -u origin main
} else {
  Write-Host "==> Creating public GitHub repo and pushing" -ForegroundColor Cyan
  gh repo create $GitHubRepo --public --source=. --remote=origin --push
}

Write-Host ""
Write-Host "GitHub is ready: https://github.com/$GitHubRepo" -ForegroundColor Green
Write-Host ""
Write-Host "Next: first npm publish (manual, needs your npm account)" -ForegroundColor Yellow
Write-Host "  npm login"
Write-Host "  npm publish --access public"
Write-Host ""
Write-Host "Then configure npm OIDC trusted publishing:" -ForegroundColor Yellow
Write-Host "  https://www.npmjs.com/package/chatluna-diary/access"
Write-Host "  Provider: GitHub Actions"
Write-Host "  Repository: $GitHubRepo"
Write-Host "  Workflow: publish.yml"
Write-Host "  Environment: (leave empty)"
Write-Host ""
Write-Host "After that, create a GitHub Release (or run the publish workflow manually); it uses OIDC and provenance." -ForegroundColor Green
