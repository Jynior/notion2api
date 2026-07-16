# Notion2API

**Notion AI → локальный OpenAI-совместимый API** (`/v1/chat/completions`) + веб-чат (Notion AI Studio) с GitHub push, режимами Plan/Build/Chat и вложениями.

> **Инструкция ниже в первую очередь рассчитана на Windows** (проверено: PowerShell, venv, Chrome/Edge).  
> Для **Linux / macOS** см. [раздел 8](#8-linux--macos) — те же шаги, другие команды.  
> **English:** [README_EN.md](./README_EN.md)

---

## Оглавление

1. [Что это и зачем](#1-что-это-и-зачем)  
2. [Что понадобится](#2-что-понадобится)  
3. [Быстрый старт (Windows)](#3-быстрый-старт-windows)  
4. [Получение Notion-аккаунта (`token_v2`)](#4-получение-notion-аккаунта-token_v2)  
5. [Расширение notion2api-exporter](#5-расширение-notion2api-exporter)  
6. [Запуск API-сервера](#6-запуск-api-сервера)  
7. [Проверка и использование API](#7-проверка-и-использование-api)  
8. [Linux / macOS](#8-linux--macos)  
9. [Веб-UI: Settings, GitHub, Plan/Build, вложения](#9-веб-ui-settings-github-planbuild-вложения)  
10. [Переменные окружения](#10-переменные-окружения)  
11. [Docker](#11-docker)  
12. [Безопасность](#12-безопасность)  
13. [Частые проблемы](#13-частые-проблемы)  
14. [Структура репозитория](#14-структура-репозитория)  
15. [Дисклеймер](#15-дисклеймер)  

---

## 1. Что это и зачем

| Компонент | Роль |
|-----------|------|
| **Notion2API (этот репо)** | Локальный сервер: подписка Notion AI → endpoint как у OpenAI |
| **Web UI** (`http://localhost:8000`) | Чат, выбор модели, GitHub commit, режимы Plan/Build, вложения |
| **notion2api-exporter** | Расширение Chrome/Edge: выгрузка `token_v2` + workspace в `accounts.json` |

**Не является** официальным API Notion / OpenAI / Anthropic.  
Это open-source мост (reverse-engineered Notion AI web). Модели и лимиты зависят от **вашей** подписки Notion.

Типичный сценарий:

```
Notion AI (подписка)
    ↑ cookie / token_v2
notion2api  (localhost:8000)
    ↑  OpenAI-compatible HTTP
Web UI / Continue / Aider / свои скрипты
```

---

## 2. Что понадобится

- **Windows 10/11** (рекомендуется) или Linux / macOS  
- **Python 3.11+** ([python.org](https://www.python.org/downloads/) — галочка “Add to PATH”)  
- **Git** (по желанию)  
- Аккаунт **Notion** с доступом к **Notion AI**  
- Браузер **Chrome** или **Edge** (для логина / расширения)  
- (Опционально) **Docker Desktop**  

> На Windows избегайте «случайного» Python из Store / чужих агентов в PATH (Hermes и т.п.).  
> Надёжнее: полный путь к `Python3xx\python.exe` или venv проекта (как в `start.ps1`).

---

## 3. Быстрый старт (Windows)

### 3.1. Скачать проект

```powershell
cd $HOME\Desktop   # или любая папка
# git clone <URL-этого-репозитория> notion2api
cd notion2api
```

### 3.2. Одним скриптом

```powershell
powershell -ExecutionPolicy Bypass -File .\start.ps1
```

Скрипт:

1. Создаст `.venv`  
2. Установит зависимости из `requirements.txt`  
3. Создаст `.env` из `.env.example` (если нет)  
4. Напомнит про `accounts.json`  
5. Запустит uvicorn на порту **8000**

### 3.3. Вручную (если скрипт не подходит)

```powershell
cd path\to\notion2api

# Обход «чужого» python в PATH — укажите свой при необходимости:
# $PY = "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe"
$PY = "python"

& $PY -m venv .venv
.\.venv\Scripts\python.exe -m pip install --upgrade pip
.\.venv\Scripts\python.exe -m pip install -r requirements.txt

copy .env.example .env
# В .env: APP_MODE=standard

# Дальше — accounts.json (раздел 4–5)

.\.venv\Scripts\python.exe -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Откройте: **http://localhost:8000**

---

## 4. Получение Notion-аккаунта (`token_v2`)

Серверу нужны минимум:

| Поле | Обязательно | Описание |
|------|-------------|----------|
| `token_v2` | **да** | Cookie сессии Notion |
| `space_id` | **да** | ID workspace |
| `user_id` | **да** | ID пользователя |
| `space_view_id` | желательно | View workspace |
| `user_name` / `user_email` | нет | Для логов / UI |

Файл: **`accounts.json`** в корне проекта (шаблон: `accounts.json.example`).  
Формат — **JSON-массив**:

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

`accounts.json` и `.env` **в git не коммитятся** (см. `.gitignore`).

---

### Способ A — расширение **notion2api-exporter** (рекомендуется)

См. [раздел 5](#5-расширение-notion2api-exporter).  
Оно само находит `token_v2` (в т.ч. на **app.notion.com**) и workspace, сохраняет `accounts.json` в нужном формате.

---

### Способ B — `login.py` (браузер + CDP)

```powershell
.\.venv\Scripts\python.exe login.py
```

Откроется Chrome/Edge → войдите в Notion → скрипт запишет `accounts.json`.

Полезные флаги:

```powershell
.\.venv\Scripts\python.exe login.py --manual   # вставить token_v2 вручную
.\.venv\Scripts\python.exe login.py --check
.\.venv\Scripts\python.exe login.py --list
```

---

### Способ C — вручную (F12 + скрипт)

#### Шаг 1. Cookie `token_v2`

1. Откройте **https://www.notion.so/ai** или **https://app.notion.com** и войдите.  
2. `F12` → вкладка **Application** (Edge: **Приложение**).  
3. **Cookies** → `https://www.notion.so` **и/или** `https://app.notion.com`.  
4. Найдите cookie **`token_v2`** → скопируйте **Value** целиком (длинная строка).

> Современный Notion часто кладёт `token_v2` на домен **`.app.notion.com`**.  
> Если на `notion.so` пусто — смотрите cookies `app.notion.com`.

#### Шаг 2. `space_id` / `user_id` / `space_view_id`

1. На той же вкладке Notion: `F12` → **Console**.  
2. Откройте файл проекта: `scripts/extract_notion_info.js`.  
3. Вставьте **весь** скрипт в Console → Enter.  
4. При нескольких аккаунтах/пространствах — выберите нужные.  
5. Скрипт выведет JSON (часто с плейсхолдером `YOUR_TOKEN_V2`).  
6. Подставьте реальный `token_v2` из шага 1.  
7. Оберните объект в массив `[{ ... }]` и сохраните как `accounts.json`.

#### Шаг 3. Проверка файла

```powershell
.\.venv\Scripts\python.exe -c "import json; a=json.load(open('accounts.json',encoding='utf-8')); print(len(a), 'account(s)'); print('ok', all(x.get('token_v2') and x.get('space_id') and x.get('user_id') for x in a))"
```

Ожидается: `ok True`.

---

## 5. Расширение notion2api-exporter

Отдельный репозиторий / папка: **`notion2api-exporter`** (Chrome / Edge, Manifest V3).

### Зачем

- Читает **httpOnly** cookie `token_v2` (в т.ч. с `app.notion.com`)  
- Тянет users / spaces через Notion API  
- Сохраняет **`accounts.json`** в формате Notion2API  
- Опции: merge с существующим файлом, тест без сохранения  

### Установка (Load unpacked)

1. Chrome: `chrome://extensions` · Edge: `edge://extensions`  
2. **Developer mode** → **Load unpacked**  
3. Укажите папку `notion2api-exporter`  
4. Откройте https://app.notion.com (или notion.so) и войдите  
5. Иконка расширения → **Извлечь сессию** / **Тест**  
6. **Сохранить accounts.json…** → в корень `notion2api` (рядом с `login.py`)

### Важно

- Расширение видит cookies **того профиля** браузера, куда установлено  
- После обновления `manifest.json` нажимайте **Reload** у расширения  
- Не публикуйте `accounts.json` и не вставляйте token в чаты  

Кратко в README расширения — зачем оно и как стыкуется с этим сервером.

---

## 6. Запуск API-сервера

### Windows (рекомендуемый путь)

```powershell
cd path\to\notion2api
.\.venv\Scripts\python.exe -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Или: `.\start.ps1`

### `.env` (минимум)

Скопируйте `.env.example` → `.env`:

```env
APP_MODE=standard
HOST=0.0.0.0
PORT=8000
# API_KEY=          # пусто = без Bearer; если задали — тот же ключ в UI/клиентах
```

Режимы:

| APP_MODE | Память | Thinking / Search | Когда |
|----------|--------|-------------------|--------|
| `lite` | нет | нет | простые Q&A |
| `standard` | клиент | да | **рекомендуется** |
| `heavy` | сервер + SQLite | да | длинные диалоги (+ опц. SiliconFlow) |

Окно с uvicorn **не закрывайте** — это backend.

---

## 7. Проверка и использование API

### Health / модели

```text
http://localhost:8000/health
http://localhost:8000/v1/models
http://localhost:8000/          ← Web UI
```

### OpenAI-совместимый клиент (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="http://localhost:8000/v1",
    api_key="any-string",  # или ваш API_KEY из .env
)

r = client.chat.completions.create(
    model="claude-sonnet4.6",
    messages=[{"role": "user", "content": "ping"}],
    stream=True,
)
for chunk in r:
    print(chunk.choices[0].delta.content or "", end="")
```

### Основные endpoints

| Endpoint | Метод | Назначение |
|----------|--------|------------|
| `/v1/chat/completions` | POST | чат (ядро) |
| `/v1/models` | GET | список моделей |
| `/health` | GET | статус пула аккаунтов |
| `/` | GET | Web UI |

### Где «взять API» для IDE / агентов

| Клиент | Что указать |
|--------|-------------|
| **Web UI** | уже ходит на тот же origin |
| **Continue** (VS Code) | `provider: openai`, `apiBase: http://localhost:8000/v1`, `model: claude-sonnet4.6` |
| **Aider** | `OPENAI_API_BASE=http://localhost:8000/v1`, `OPENAI_API_KEY=any`, `--model openai/claude-sonnet4.6` |
| **OpenCode** | custom provider, base URL `http://localhost:8000/v1` (tool-agent **ограничен**: нет полноценных tool_calls) |
| Свои скрипты | любой SDK с `base_url` OpenAI |

Имена моделей — **ровно** как в `GET /v1/models` (например `claude-sonnet4.6`, `gpt-5.5`).  
Список зависит от Notion и `app/model_registry.py`. Новые модели (Fable5 и т.д.) — только если известен **внутренний** id из Network Notion.

---

## 8. Linux / macOS

```bash
cd path/to/notion2api
chmod +x start.sh
./start.sh
```

Вручную:

```bash
python3 -m venv .venv
source .venv/bin/activate   # fish: source .venv/bin/activate.fish
pip install -U pip
pip install -r requirements.txt

cp .env.example .env
# APP_MODE=standard

# credentials:
#   python login.py
#   или accounts.json через notion2api-exporter / F12

python -m uvicorn app.server:app --host 0.0.0.0 --port 8000
```

Расширение: тот же **Chrome/Chromium/Edge** → Load unpacked → `notion2api-exporter`.

Отличия от Windows:

| | Windows | Linux/macOS |
|--|---------|-------------|
| venv python | `.\.venv\Scripts\python.exe` | `.venv/bin/python` |
| activate | `.\.venv\Scripts\Activate.ps1` | `source .venv/bin/activate` |
| start | `start.ps1` | `./start.sh` |

Логика API и UI **та же**.

---

## 9. Веб-UI: Settings, GitHub, Plan/Build, вложения

После старта сервера откройте **http://localhost:8000**.

Внизу слева (sidebar) нажмите **Settings** — откроется модальное окно с настройками API и GitHub.

---

### 9.1. Как открыть Settings

1. Запустите uvicorn (раздел 6).  
2. В браузере: `http://localhost:8000`.  
3. Слева внизу кнопка **Settings**.  
4. Заполните поля → **Save changes**.  

Все значения (Base URL, API Key, GitHub PAT и т.д.) хранятся в **localStorage браузера**, не на сервере и не в `accounts.json`.

---

### 9.2. Base URL

| Поле | Что вписать | Зачем |
|------|-------------|--------|
| **Base URL** | `http://localhost:8000` | Куда UI шлёт запросы (`/v1/chat/completions`, `/v1/models`) |

- По умолчанию подставляется `window.location.origin` (тот же хост, с которого открыт UI).  
- Если UI открыт на `http://localhost:8000`, обычно **менять не нужно**.  
- Меняйте, если сервер на другом порту/машине, например:
  - `http://127.0.0.1:8000`
  - `http://192.168.1.10:8000` (другой ПК в LAN)
- **Без** `/v1` в конце — UI сам добавит путь API.  
  Верно: `http://localhost:8000`  
  Не нужно: `http://localhost:8000/v1`

Если Base URL неверный → чат не отвечает, модели не грузятся, в Network будут failed fetch / CORS / connection refused.

---

### 9.3. API Key (в Settings)

| Ситуация | Что делать в Settings |
|----------|------------------------|
| В `.env` **`API_KEY` пустой** | Поле **API Key** можно оставить пустым |
| В `.env` задан, напр. `API_KEY=mysecret` | В Settings введите **тот же** `mysecret` |
| Ключи не совпали | Ошибка вроде `invalid_api_key` / 401 |

Это **не** OpenAI-ключ и **не** Notion token.  
Это только локальный Bearer для защиты **вашего** notion2api.

---

### 9.4. GitHub в Settings (пошагово)

Нужно, если хотите пушить файлы из ответа чата (code fences) в GitHub прямо из UI.

#### Шаг A. Создать Personal Access Token (PAT) на GitHub

**Вариант 1 — Classic PAT (рекомендуется, проще):**

1. Войдите на [github.com](https://github.com) → аватар (справа сверху) → **Settings**.  
2. Внизу слева: **Developer settings**.  
3. **Personal access tokens** → **Tokens (classic)**.  
4. **Generate new token** → **Generate new token (classic)**.  
5. **Note**: любое имя, напр. `notion2api-local`.  
6. **Expiration**: на ваш выбор (30 days / 90 days / No expiration).  
7. **Scopes** — поставьте галочку **`repo`** (полный доступ к private/public репозиториям).  
8. **Generate token**.  
9. **Сразу скопируйте** токен (`ghp_…`) — GitHub больше его не покажет.

**Вариант 2 — Fine-grained PAT:**

1. **Developer settings** → **Personal access tokens** → **Fine-grained tokens** → **Generate new token**.  
2. **Resource owner** — ваш аккаунт.  
3. **Repository access** — **Only select repositories** → выберите **именно тот** repo, куда будете пушить (или All, если нужно).  
4. **Permissions** → **Repository permissions**:
   - **Contents**: **Read and write**
   - **Administration**: **Read** (чтобы UI мог создать/инициализировать repo при необходимости)
   - (по желанию) **Metadata**: Read (обычно уже есть)
5. Generate → скопируйте `github_pat_…`.

> Classic с `repo` обычно меньше сюрпризов (404 / insufficient_scope).  
> Fine-grained удобнее ограничить одним репозиторием.

#### Шаг B. Заполнить поля в Settings

| Поле | Пример | Пояснение |
|------|--------|-----------|
| **GitHub PAT** | `ghp_xxxx…` или `github_pat_…` | Токен из шага A |
| **Repository** | `YourLogin/your-repo` | Формат **`owner/name`**, не полный URL |
| **Branch** | `main` | Куда пушить; кнопка **↻** подтягивает список веток с GitHub |
| **Path prefix** | `generated/` или пусто | Опциональный префикс ко всем путям файлов |

**Чекбоксы:**

| Опция | Смысл |
|-------|--------|
| **Новые repo создавать как private** | Если UI создаёт репозиторий — сделать private |
| **Если repo не найден — создать и init** | Auto-create + README через API |
| **GitHub coding mode** | В каждый запрос system-prompt: отвечать code fence’ами с путями (под push) |
| **Auto-push** | После ответа сразу пушить найденные fences |

#### Шаг C. Проверить и сохранить

1. **1) Test connection** — должен показать ваш `@login` GitHub и доступ к repo.  
   - Если `ownerMatch === false` — в **Repository** owner должен совпадать с аккаунтом PAT (см. `@login` в статусе).  
2. **2) Ensure repo** — создать/инициализировать repo, если его ещё нет.  
3. **Save changes**.

PAT **не уходит** на ваш notion2api-сервер как «секрет сервера» — UI ходит в GitHub API **из браузера** (localStorage).

#### Шаг D. Как пушить код из чата

Модель (лучше **Build** + **GitHub coding mode**) должна отдавать fences **с путём файла**:

````markdown
```src/hello.py
print("hello")
```
````

Дальше в UI: кнопки push / **Fix & push** (если shell-строки склеились), либо **Auto-push**.

Папки (`src/utils/…`) GitHub создаёт сам по пути в имени fence.

---

### 9.5. Режимы Chat / Plan / Build

Селектор **Mode** рядом с моделью (это **промпт-режимы**, не полноценный tool-agent):

| Mode | Поведение |
|------|-----------|
| **Chat** | обычный диалог |
| **Plan** | опрос / план, без implementation push; quiz UI при fence `plan-quiz` |
| **Build** | код в fences с путями → удобно для GitHub |

---

### 9.6. Вложения (+)

Кнопка **+** у поля ввода: картинки / текстовые файлы (лимиты ~5×5MB).  
Картинки сжимаются; backend сплющивает multimodal в текст/data-URL для Notion.  
Vision через reverse API — best-effort, не 100% как веб Notion.

---

### 9.7. Continue / Aider (кодер в папке проекта)

Сам Web UI **не** правит локальный диск.  
Для IDE: Continue или Aider + `base_url=http://localhost:8000/v1` (раздел 7).

В IDE **Base URL / API Base** = `http://localhost:8000/v1` (здесь `/v1` **нужен**).  
В Web UI Settings **Base URL** = `http://localhost:8000` (**без** `/v1`).

---

## 10. Переменные окружения

См. `.env.example`. Важное:

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `APP_MODE` | lite / standard / heavy | heavy (лучше явно `standard`) |
| `API_KEY` | Bearer для `/v1/*` | пусто = без auth |
| `HOST` / `PORT` | bind | `0.0.0.0` / `8000` |
| `NOTION_ACCOUNTS` | JSON аккаунтов (если нет файла) | — |
| `SILICONFLOW_API_KEY` | для heavy-сжатия | — |
| `ALLOWED_ORIGINS` | CORS | `*` |

Приоритет аккаунтов: **`accounts.json`** > `NOTION_ACCOUNTS` в env.

---

## 11. Docker

```bash
# заполните accounts.json и .env
docker-compose build --no-cache
docker-compose up -d
docker-compose logs -f --tail=50
docker-compose restart   # после правки accounts.json
docker-compose down
```

Порт хоста: `HOST_PORT` / `8000`.

---

## 12. Безопасность

- **Не коммитьте** `accounts.json`, `.env`, PAT, cookies  
- Token Notion = доступ к workspace; GitHub PAT = доступ к репо  
- Не публикуйте скрины с Value cookie  
- Reverse-прокси Notion: риск лимитов (429), блокировок, поломки при обновлении Notion  
- Используйте на свой страх и риск (ToS Notion / GitHub)

---

## 13. Частые проблемы

| Симптом | Что проверить |
|---------|----------------|
| `No module named uvicorn` | `pip install -r requirements.txt` **в** `.venv` |
| `token_v2 not found` (exporter) | login на **app.notion.com**, Reload extension, тот же профиль Chrome |
| `invalid_api_key` в UI | `API_KEY` в `.env` vs Settings UI — совпадите или очистите |
| `accounts.json` / 503 Notion | token протух → exporter / `login.py` заново |
| 429 | реже запросы, второй аккаунт в массиве |
| Hermes / чужой `python` | полный путь к Python 3.11+ или только `.venv\Scripts\python.exe` |
| GitHub push refuse / verify | Fix & push; CRLF; один клик; см. панель статуса |
| OpenCode «не создаёт папки» | нет tool_calls у моста — файлы через Web UI GitHub или Continue/Aider |
| Модели «нет Fable5» | нужен internal model id из Network Notion + правка `app/model_registry.py` |

---

## 14. Структура репозитория

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
├── README.md            # русский (полный)
└── README_EN.md         # English (full)
```

Рядом (отдельный репозиторий): **`notion2api-exporter`** — выгрузка credentials.

---

## 15. Дисклеймер

Проект для образовательных и личных сценариев.  
Авторы и контрибьюторы **не несут ответственности** за блокировки аккаунтов, потерю данных или нарушение ToS сторонних сервисов.  
Используя софт, вы подтверждаете, что понимаете риски reverse-engineering и хранения сессионных токенов.

---

## Чеклист «всё поднято»

- [ ] Python 3.11+  
- [ ] `.venv` + `pip install -r requirements.txt`  
- [ ] `.env` с `APP_MODE=standard`  
- [ ] `accounts.json` с валидными `token_v2`, `space_id`, `user_id`  
- [ ] `uvicorn` слушает `:8000`  
- [ ] `/health` → ok  
- [ ] `/v1/models` → список моделей  
- [ ] UI открывается, чат отвечает  
- [ ] Settings: Base URL = `http://localhost:8000`  
- [ ] (опц.) GitHub PAT + Test connection  
- [ ] (опц.) Continue/Aider на `http://localhost:8000/v1`  

---

**Связанные проекты**

- **notion2api** — этот сервер и UI  
- **notion2api-exporter** — браузерное расширение для `accounts.json`  

Если инструкция помогла — поставьте Star на GitHub (когда репозиторий опубликован).
