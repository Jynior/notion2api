# Notion2API — quick start (Windows PowerShell)
# Usage: right-click → Run with PowerShell, or: powershell -ExecutionPolicy Bypass -File .\start.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$PyCandidates = @(
  "$PSScriptRoot\.venv\Scripts\python.exe",
  "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
  "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
  "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
  "python"
)

function Find-Python {
  foreach ($c in $PyCandidates) {
    if ($c -eq "python") {
      $cmd = Get-Command python -ErrorAction SilentlyContinue
      if ($cmd -and $cmd.Source -notmatch "hermes|WindowsApps") { return $cmd.Source }
      continue
    }
    if (Test-Path $c) { return $c }
  }
  return $null
}

$sysPy = Find-Python
if (-not $sysPy) {
  Write-Host "Python not found. Install Python 3.11+ from python.org and re-run." -ForegroundColor Red
  exit 1
}

if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
  Write-Host "Creating .venv with $sysPy ..." -ForegroundColor Cyan
  & $sysPy -m venv .venv
}

$VPY = "$PSScriptRoot\.venv\Scripts\python.exe"
Write-Host "Using: $VPY" -ForegroundColor DarkGray

& $VPY -m pip install -q --upgrade pip
& $VPY -m pip install -q -r requirements.txt

if (-not (Test-Path ".\.env")) {
  Copy-Item ".\.env.example" ".\.env"
  Write-Host "Created .env from .env.example — set APP_MODE=standard" -ForegroundColor Yellow
}

if (-not (Test-Path ".\accounts.json")) {
  if (Test-Path ".\accounts.json.example") {
    Copy-Item ".\accounts.json.example" ".\accounts.json"
  }
  Write-Host ""
  Write-Host "accounts.json is missing or empty template." -ForegroundColor Yellow
  Write-Host "  1) Prefer: browser extension notion2api-exporter (see README)" -ForegroundColor Yellow
  Write-Host "  2) Or: & .\.venv\Scripts\python.exe login.py" -ForegroundColor Yellow
  Write-Host "  3) Or: fill accounts.json manually (token_v2 + space_id + user_id)" -ForegroundColor Yellow
  Write-Host ""
}

Write-Host "Starting server on http://127.0.0.1:8000 ..." -ForegroundColor Green
Write-Host "UI:  http://localhost:8000" -ForegroundColor Green
Write-Host "API: http://localhost:8000/v1/models" -ForegroundColor Green
Write-Host "Stop: Ctrl+C" -ForegroundColor DarkGray
Write-Host ""

& $VPY -m uvicorn app.server:app --host 0.0.0.0 --port 8000
