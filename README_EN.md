# Notion2API

**Notion AI → local OpenAI-compatible API** (`/v1/chat/completions`) + web chat (Notion AI Studio) with GitHub push, Plan/Build/Chat modes, and attachments.

> **The primary walkthrough is written for Windows** (verified: PowerShell, venv, Chrome/Edge).  
> For **Linux / macOS**, see [section 8](#8-linux--macos) — same steps, different commands.  
> **Русский:** [README.md](./README.md)

---

## Table of contents

1. [What this is](#1-what-this-is)  
2. [Requirements](#2-requirements)  
3. [Quick start (Windows)](#3-quick-start-windows)  
4. [Getting a Notion account (`token_v2`)](#4-getting-a-notion-account-token_v2)  
5. [Extension: notion2api-exporter](#5-extension-notion2api-exporter)  
6. [Starting the API server](#6-starting-the-api-server)  
7. [Verify and use the API](#7-verify-and-use-the-api)  
8. [Linux / macOS](#8-linux--macos)  
9. [Web UI: Settings, GitHub, Plan/Build, attachments](#9-web-ui-settings-github-planbuild-attachments)  
10. [Environment variables](#10-environment-variables)  
11. [Docker](#11-docker)  
12. [Security](#12-security)  
13. [Troubleshooting](#13-troubleshooting)  
14. [Repository layout](#14-repository-layout)  
15. [Disclaimer](#15-disclaimer)  

---

## 1. What this is

| Component | Role |
|-----------|------|
| **Notion2API (this repo)** | Local server: your Notion AI subscription → OpenAI-style endpoint |
| **Web UI** (`http://localhost:8000`) | Chat, model picker, GitHub commit, Plan/Build modes, attachments |
| **notion2api-exporter** | Chrome/Edge extension: export `token_v2` + workspace into `accounts.json` |

**Not** an official Notion / OpenAI / Anthropic API.  
This is an open-source bridge (reverse-engineered Notion AI web). Models and limits depend on **your** Notion plan.

Typical flow:

```
Notion AI (subscription)
    ↑ cookie / token_v2
notion2api  (localhost:8000)
    ↑  OpenAI-compatible HTTP
Web UI / Continue / Aider / your scripts
```

---

## 2. Requirements

- **Windows 10/11** (recommended) or Linux / macOS  
- **Python 3.11+** ([python.org](https://www.python.org/downloads/) — check “Add to PATH”)  
- **Git** (optional)  
- A **Notion** account with **Notion AI** access  
- **Chrome** or **Edge** (login / extension)  
- (Optional) **Docker Desktop**  

> On Windows, avoid a random Python from the Store / other agents on PATH (e.g. Hermes).  
> Prefer a full path to `Python3xx\python.exe` or the project venv (as in `start.ps1`).

---

## 3. Quick start (Windows)

### 3.1. Get the project

```powershell
cd $HOME\Desktop   # or any folder
# git clone <URL-of-this-repo> notion2api
cd notion2api
```

### 3.2. One-shot script

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

The script will:

1. Create `.venv`  
2. Install deps from `requirements.txt`  
3. Create `.env` from `.env.example` (if missing)  
4. Remind you about `accounts.json`  
5. Start uvicorn on port **8000**

### 3.3. Manual steps

```powershell
cd path\to\notion2api

# If PATH has a wrong python, set yours:
# $PY = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
$PY = "python"

& $PY -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

copy .env.example .env
# In .env: APP_MODE=standard

# Then accounts.json (sections 4–5)

.\.venv\Scripts\python.exe -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Open: **http://localhost:8000**

---

## 4. Getting a Notion account (`token_v2`)

Minimum fields the server needs:

| Field | Required | Description |
|-------|----------|-------------|
| `token_v2` | **yes** | Notion session cookie |
| `space_id` | **yes** | Workspace ID |
| `user_id` | **yes** | User ID |
| `space_view_id` | recommended | Workspace view |
| `user_name` / `user_email` | no | Logs / UI |

File: **`accounts.json`** in the project root (template: `accounts.json.example`).  
Format — a **JSON array**:

```json
[
  {
    "profile_name": "default",
    "token_v2": "...",
    "space_id": "...",
    "user_id": "...",
    "space_view_id": "...",
    "user_name": "...",
    "user_email": "..."
  }
]
```

`accounts.json` and `.env` are **not** committed (see `.gitignore`).

---

### Method A — **notion2api-exporter** (recommended)

See [section 5](#5-extension-notion2api-exporter).  
It finds `token_v2` (including on **app.notion.com**) and workspace data, then saves `accounts.json` in the correct format.

---

### Method B — `login.py` (browser + CDP)

```powershell
.\.venv\Scripts\python.exe login.py
```

Chrome/Edge opens → sign in to Notion → script writes `accounts.json`.

Useful flags:

```powershell
.\.venv\Scripts\python.exe login.py --manual   # paste token_v2 by hand
.\.venv\Scripts\python.exe login.py --check
.\.venv\Scripts\python.exe login.py --list
```

---

### Method C — manual (F12 + script)

#### Step 1. Cookie `token_v2`

1. Open **https://www.notion.so/ai** or **https://app.notion.com** and sign in.  
2. `F12` → **Application** tab (Edge: **Application** / “Приложение”).  
3. **Cookies** → `https://www.notion.so` **and/or** `https://app.notion.com`.  
4. Find cookie **`token_v2`** → copy the full **Value** (long string).

> Modern Notion often stores `token_v2` on **`.app.notion.com`**.  
> If empty on `notion.so`, check cookies for `app.notion.com`.

#### Step 2. `space_id` / `user_id` / `space_view_id`

1. Same Notion tab: `F12` → **Console**.  
2. Open project file: `scripts/extract_notion_info.js`.  
3. Paste the **entire** script into Console → Enter.  
4. If multiple accounts/spaces — pick the ones you need.  
5. Script prints JSON (often with placeholder `YOUR_TOKEN_V2`).  
6. Replace with the real `token_v2` from step 1.  
7. Wrap the object in an array `[{ ... }]` and save as `accounts.json`.

#### Step 3. Validate the file

```powershell
.\.venv\Scripts\python.exe -c "import json; a=json.load(open('accounts.json',encoding='utf-8')); print(len(a), 'account(s)'); print('ok', all(x.get('token_v2') and x.get('space_id') and x.get('user_id') for x in a))"
```

Expected: `ok True`.

---

## 5. Extension: notion2api-exporter

Separate repo/folder: **`notion2api-exporter`** (Chrome / Edge, Manifest V3).

### Why

- Reads **httpOnly** cookie `token_v2` (including `app.notion.com`)  
- Fetches users / spaces via Notion APIs  
- Saves **`accounts.json`** in Notion2API format  
- Options: merge with existing file, dry-run test  

### Install (Load unpacked)

1. Chrome: `chrome://extensions` · Edge: `edge://extensions`  
2. **Developer mode** → **Load unpacked**  
3. Select the `notion2api-exporter` folder  
4. Open https://app.notion.com (or notion.so) and sign in  
5. Extension icon → **Extract session** / **Test**  
6. **Save accounts.json…** → into the `notion2api` root (next to `login.py`)

### Notes

- Extension only sees cookies of the **browser profile** it is installed in  
- After `manifest.json` changes, click **Reload** on the extension  
- Never publish `accounts.json` or paste tokens into chats  

The extension README covers what it does and how it plugs into this server.

---

## 6. Starting the API server

### Windows (recommended)

```powershell
cd path\to\notion2api
.\.venv\Scripts\python.exe -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Or: `.\start.ps1`

### `.env` (minimum)

Copy `.env.example` → `.env`:

```env
APP_MODE=standard
HOST=0.0.0.0
PORT=8000
# API_KEY=          # empty = no Bearer; if set, use the same key in UI/clients
```

Modes:

| APP_MODE | Memory | Thinking / Search | When |
|----------|--------|-------------------|------|
| `lite` | no | no | simple Q&A |
| `standard` | client-side | yes | **recommended** |
| `heavy` | server + SQLite | yes | long chats (+ optional SiliconFlow) |

Keep the uvicorn window open — that is the backend.

---

## 7. Verify and use the API

### Health / models

```text
http://localhost:8000/health
http://localhost:8000/v1/models
http://localhost:8000/          ← Web UI
```

### OpenAI-compatible client (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="any-string",  # or your API_KEY from .env
)

r = client.chat.completions.create(
    model="claude-sonnet4.6",
    messages=[{"role": "user", "content": "ping"}],
    stream=True,
)
for chunk in r:
    print(chunk.choices[0].delta.content or "", end="")
```

### Main endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/v1/chat/completions` | POST | chat (core) |
| `/v1/models` | GET | model list |
| `/health` | GET | account pool status |
| `/` | GET | Web UI |

### Where to point IDEs / agents

| Client | What to set |
|--------|-------------|
| **Web UI** | same origin (see Settings → Base URL) |
| **Continue** (VS Code) | `provider: openai`, `apiBase: http://localhost:8000/v1`, `model: claude-sonnet4.6` |
| **Aider** | `OPENAI_API_BASE=http://localhost:8000/v1`, `OPENAI_API_KEY=any`, `--model openai/claude-sonnet4.6` |
| **OpenCode** | custom provider, base URL `http://localhost:8000/v1` (tool-agent is **limited**: no real tool_calls) |
| Your scripts | any OpenAI SDK with `base_url` |

Model names must match **`GET /v1/models`** exactly (e.g. `claude-sonnet4.6`, `gpt-5.5`).  
List depends on Notion and `app/model_registry.py`. New models only work if you know the **internal** id from Notion Network traffic.

---

## 8. Linux / macOS

```bash
cd path/to/notion2api
chmod +x start.sh
./start.sh
```

Manual:

```bash
python3 -m venv .venv
source .venv/bin/activate   # fish: source .venv/bin/activate.fish
pip install -U pip
pip install -r requirements.txt

cp .env.example .env
# APP_MODE=standard

# credentials:
#   python login.py
#   or accounts.json via notion2api-exporter / F12

python -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Extension: same **Chrome/Chromium/Edge** → Load unpacked → `notion2api-exporter`.

Windows vs Unix:

| | Windows | Linux/macOS |
|--|---------|-------------|
| venv python | `.\.venv\Scripts\python.exe` | `.venv/bin/python` |
| activate | `.\.venv\Scripts\Activate.ps1` | `source .venv/bin/activate` |
| start | `start.ps1` | `./start.sh` |

API and UI logic are the **same**.

---

## 9. Web UI: Settings, GitHub, Plan/Build, attachments

After the server is up, open **http://localhost:8000**.

Bottom-left sidebar → **Settings** — modal for API + GitHub configuration.

---

### 9.1. Open Settings

1. Start uvicorn (section 6).  
2. Browser: `http://localhost:8000`.  
3. Bottom-left **Settings**.  
4. Fill fields → **Save changes**.  

All values (Base URL, API Key, GitHub PAT, etc.) live in the browser **localStorage** — not on the server and not in `accounts.json`.

---

### 9.2. Base URL

| Field | Value | Purpose |
|-------|--------|---------|
| **Base URL** | `http://localhost:8000` | Where the UI sends API traffic (`/v1/chat/completions`, `/v1/models`) |

- Default is `window.location.origin` (same host as the UI page).  
- If the UI is already at `http://localhost:8000`, you usually **leave it as is**.  
- Change it if the server is on another port/host, e.g.:
  - `http://127.0.0.1:8000`
  - `http://192.168.1.10:8000` (another machine on LAN)
- **Do not** append `/v1` — the UI adds API paths itself.  
  Correct: `http://localhost:8000`  
  Wrong: `http://localhost:8000/v1`

Bad Base URL → chat fails, models don’t load, Network shows failed fetch / CORS / connection refused.

---

### 9.3. API Key (in Settings)

| Situation | What to put in Settings |
|-----------|-------------------------|
| `.env` has **empty** `API_KEY` | Leave **API Key** empty |
| `.env` has e.g. `API_KEY=mysecret` | Enter the **same** `mysecret` |
| Mismatch | Errors like `invalid_api_key` / 401 |

This is **not** an OpenAI key and **not** a Notion token.  
It is only a local Bearer to protect **your** notion2api instance.

---

### 9.4. GitHub in Settings (step by step)

Use this if you want to push files from chat replies (code fences) to GitHub from the UI.

#### Step A. Create a Personal Access Token (PAT) on GitHub

**Option 1 — Classic PAT (recommended, simplest):**

1. Sign in at [github.com](https://github.com) → avatar (top right) → **Settings**.  
2. Scroll left sidebar: **Developer settings**.  
3. **Personal access tokens** → **Tokens (classic)**.  
4. **Generate new token** → **Generate new token (classic)**.  
5. **Note**: any label, e.g. `notion2api-local`.  
6. **Expiration**: your choice (30 days / 90 days / No expiration).  
7. **Scopes** — enable **`repo`** (full access to private/public repos).  
8. **Generate token**.  
9. **Copy immediately** (`ghp_…`) — GitHub will not show it again.

**Option 2 — Fine-grained PAT:**

1. **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.  
2. **Resource owner** — your account.  
3. **Repository access** — **Only select repositories** → pick **the exact** repo you will push to (or All if needed).  
4. **Permissions** → **Repository permissions**:
   - **Contents**: **Read and write**
   - **Administration**: **Read** (so the UI can create/init a repo if needed)
   - (optional) **Metadata**: Read (usually included)
5. Generate → copy `github_pat_…`.

> Classic with `repo` usually means fewer surprises (404 / insufficient_scope).  
> Fine-grained is better when you want a single-repo scope.

#### Step B. Fill Settings fields

| Field | Example | Notes |
|-------|---------|--------|
| **GitHub PAT** | `ghp_xxxx…` or `github_pat_…` | Token from step A |
| **Repository** | `YourLogin/your-repo` | Format **`owner/name`**, not a full URL |
| **Branch** | `main` | Target branch; **↻** loads branch list from GitHub |
| **Path prefix** | `generated/` or empty | Optional prefix for all file paths |

**Checkboxes:**

| Option | Meaning |
|--------|---------|
| **Create new repos as private** | If the UI creates a repo, make it private |
| **Create/init repo if missing** | Auto-create + README via API |
| **GitHub coding mode** | Injects a system prompt: answer with path-based code fences (for push) |
| **Auto-push** | After each reply, push detected fences immediately |

#### Step C. Test and save

1. **1) Test connection** — should show your GitHub `@login` and repo access.  
   - If `ownerMatch === false` — set **Repository** owner to match the PAT account (see `@login` in the status).  
2. **2) Ensure repo** — create/init the repo if it does not exist yet.  
3. **Save changes**.

The PAT is **not** stored as a server secret on notion2api — the UI calls the GitHub API **from the browser** (localStorage).

#### Step D. Push code from chat

The model (preferably **Build** + **GitHub coding mode**) should return fences **with a file path**:

````markdown
```src/hello.py
print("hello")
```
````

Then use UI push / **Fix & push** (if shell lines got glued), or **Auto-push**.

Folders (`src/utils/…`) are created by GitHub from the path in the fence name.

---

### 9.5. Chat / Plan / Build modes

**Mode** selector next to the model (these are **prompt modes**, not a full tool-agent):

| Mode | Behavior |
|------|----------|
| **Chat** | normal dialogue |
| **Plan** | Q&A / plan, no implementation push; quiz UI for `plan-quiz` fences |
| **Build** | code in path fences → good for GitHub |

---

### 9.6. Attachments (+)

**+** next to the input: images / text files (limits ~5×5MB).  
Images are compressed; backend flattens multimodal into text/data-URL for Notion.  
Vision via the reverse API is best-effort, not 100% like Notion’s own web UI.

---

### 9.7. Continue / Aider (edit files on disk)

The Web UI itself **does not** write to your local disk.  
For IDE workflows: Continue or Aider with `base_url=http://localhost:8000/v1` (section 7).

In IDEs, **Base URL / API Base** = `http://localhost:8000/v1` (`/v1` **is required**).  
In Web UI Settings, **Base URL** = `http://localhost:8000` (**no** `/v1`).

---

## 10. Environment variables

See `.env.example`. Important ones:

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_MODE` | lite / standard / heavy | heavy (prefer explicit `standard`) |
| `API_KEY` | Bearer for `/v1/*` | empty = no auth |
| `HOST` / `PORT` | bind | `0.0.0.0` / `8000` |
| `NOTION_ACCOUNTS` | JSON accounts (if no file) | — |
| `SILICONFLOW_API_KEY` | heavy-mode compression | — |
| `ALLOWED_ORIGINS` | CORS | `*` |

Account priority: **`accounts.json`** > `NOTION_ACCOUNTS` in env.

---

## 11. Docker

```bash
# fill accounts.json and .env first
docker-compose build --no-cache
docker-compose up -d
docker-compose logs -f --tail=50
docker-compose restart   # after editing accounts.json
docker-compose down
```

Host port: `HOST_PORT` / `8000`.

---

## 12. Security

- **Do not commit** `accounts.json`, `.env`, PATs, cookies  
- Notion token = workspace access; GitHub PAT = repo access  
- Don’t publish screenshots showing cookie Values  
- Reverse-proxying Notion: rate limits (429), bans, breakage when Notion changes  
- Use at your own risk (Notion / GitHub ToS)

---

## 13. Troubleshooting

| Symptom | Check |
|---------|--------|
| `No module named uvicorn` | `pip install -r requirements.txt` **inside** `.venv` |
| `token_v2 not found` (exporter) | login on **app.notion.com**, Reload extension, same Chrome profile |
| `invalid_api_key` in UI | `.env` `API_KEY` vs Settings API Key — match or clear both |
| `accounts.json` / Notion 503 | token expired → exporter / `login.py` again |
| 429 | slower requests; add a second account to the array |
| Hermes / wrong `python` | full path to Python 3.11+ or only `.venv\Scripts\python.exe` |
| GitHub push refuse / verify | Fix & push; CRLF; single click; status panel |
| OpenCode “doesn’t create folders” | no tool_calls on this bridge — use Web UI GitHub or Continue/Aider |
| Missing model “Fable5” | need internal model id from Notion Network + `app/model_registry.py` |
| Chat dead after Settings change | Base URL wrong / missing server / CORS |

---

## 14. Repository layout

```text
notion2api/
├── app/                 # FastAPI backend
│   ├── server.py
│   ├── api/
│   ├── model_registry.py
│   └── ...
├── frontend/            # Web UI (index.html + js/)
│   ├── index.html
│   └── js/github-integration.js
├── scripts/
│   └── extract_notion_info.js
├── login.py
├── requirements.txt
├── .env.example
├── accounts.json.example
├── start.ps1            # Windows
├── start.sh             # Linux / macOS
├── docker-compose.yml
├── README.md            # Russian (full)
└── README_EN.md         # English (full)
```

Sibling project (separate repo): **`notion2api-exporter`** — credential export.

---

## 15. Disclaimer

For educational and personal use.  
Authors and contributors are **not responsible** for account bans, data loss, or ToS violations of third-party services.  
By using this software you accept the risks of reverse engineering and storing session tokens.

---

## Checklist “everything is up”

- [ ] Python 3.11+  
- [ ] `.venv` + `pip install -r requirements.txt`  
- [ ] `.env` with `APP_MODE=standard`  
- [ ] `accounts.json` with valid `token_v2`, `space_id`, `user_id`  
- [ ] uvicorn listening on `:8000`  
- [ ] `/health` → ok  
- [ ] `/v1/models` → model list  
- [ ] UI opens, chat replies  
- [ ] Settings: Base URL = `http://localhost:8000`  
- [ ] (optional) GitHub PAT + Test connection  
- [ ] (optional) Continue/Aider on `http://localhost:8000/v1`  

---

**Related projects**

- **notion2api** — this server and UI  
- **notion2api-exporter** — browser extension for `accounts.json`  

If this helped, star the repo on GitHub once it’s published.
