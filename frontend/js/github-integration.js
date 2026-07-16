/* ===== GITHUB INTEGRATION (PAT → Contents API) ===== */
window.NotionAI = window.NotionAI || {};
window.NotionAI.GitHub = {
  STORAGE_KEY: 'notion2api_github',
  LANG_EXT: {
    python: 'py', py: 'py', javascript: 'js', js: 'js', typescript: 'ts', ts: 'ts',
    tsx: 'tsx', jsx: 'jsx', html: 'html', css: 'css', json: 'json', md: 'md',
    markdown: 'md', yaml: 'yml', yml: 'yml', sh: 'sh', bash: 'sh', shell: 'sh',
    go: 'go', rust: 'rs', java: 'java', c: 'c', cpp: 'cpp', csharp: 'cs',
    php: 'php', ruby: 'rb', sql: 'sql', toml: 'toml', xml: 'xml', swift: 'swift',
    kotlin: 'kt', text: 'txt', txt: 'txt',
  },

  normalizeRepo(input) {
    let s = String(input || '').trim();
    if (!s) return '';
    s = s.replace(/\.git$/i, '');
    const m =
      s.match(/(?:github\.com[/:]|github\.com\/)([\w.-]+)\/([\w.-]+)/i) ||
      s.match(/^([\w.-]+)\/([\w.-]+)$/);
    if (m) return `${m[1]}/${m[2]}`;
    s = s.replace(/^https?:\/\//i, '').replace(/^github\.com\//i, '').replace(/\/+$/, '');
    const parts = s.split('/').filter(Boolean);
    if (parts.length >= 2) return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
    return s;
  },

  load() {
    try {
      const raw = JSON.parse(localStorage.getItem(this.STORAGE_KEY) || '{}') || {};
      if (raw.repo) raw.repo = this.normalizeRepo(raw.repo);
      return raw;
    } catch (e) {
      return {};
    }
  },

  save(cfg) {
    const prev = this.load();
    const next = {
      token: cfg.token !== undefined ? cfg.token : prev.token || '',
      repo: this.normalizeRepo(cfg.repo !== undefined ? cfg.repo : prev.repo || ''),
      branch: cfg.branch !== undefined ? cfg.branch : prev.branch || 'main',
      prefix: cfg.prefix !== undefined ? cfg.prefix : prev.prefix || '',
      privateRepo:
        cfg.privateRepo !== undefined ? !!cfg.privateRepo : prev.privateRepo !== false,
      autoCreate:
        cfg.autoCreate !== undefined ? !!cfg.autoCreate : prev.autoCreate !== false,
      // Always teach the model: files = code fences for GitHub push
      injectMode:
        cfg.injectMode !== undefined ? !!cfg.injectMode : prev.injectMode !== false,
      // After reply, auto-push detected fences (user can turn off)
      autoPush:
        cfg.autoPush !== undefined ? !!cfg.autoPush : prev.autoPush === true,
    };
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(next));
    return next;
  },

  isConfigured() {
    const c = this.load();
    const repo = this.normalizeRepo(c.repo);
    return !!(c.token && repo && repo.includes('/') && !repo.includes('github.com'));
  },

  /** Fixed system instructions for GitHub code-fence output + repo context. */
  buildSystemPrompt() {
    const c = this.load();
    const repo = this.normalizeRepo(c.repo) || 'owner/repo';
    const branch = c.branch || 'main';
    const pref = (c.prefix || '').replace(/^\/+|\/+$/g, '');
    const prefNote = pref
      ? `Path prefix in repo: "${pref}/" (include it in fence paths or the UI will add it).`
      : 'No path prefix.';
    return [
      'You are a coding assistant whose output is committed to GitHub via an automated bridge.',
      `Target repository: ${repo} (branch: ${branch}). ${prefNote}`,
      '',
      'CRITICAL RULES:',
      '1) NEVER create Notion pages, databases, or use Notion workspace tools.',
      '2) NEVER run web search unless the user explicitly asks for research.',
      '3) When the user asks to create / write / edit / fix / add / generate / scaffold',
      '   any file, folder, project, script, config, or code — respond ONLY by writing',
      '   the file contents as markdown fenced code blocks with the PATH in the fence tag.',
      '4) Correct format (path in the opening fence):',
      '```src/hello.py',
      'print("hello")',
      '```',
      '5) Multiple files = multiple fences, each with its own path.',
      '6) Folders are paths inside the fence name (e.g. app/api/routes.ts).',
      '   Empty folder: use path folder/.gitkeep with a short placeholder.',
      '7) Do not say you cannot access the filesystem — the bridge will push fences to GitHub.',
      '8) Brief note after fences is OK; the fences themselves are mandatory for any file work.',
      '9) If the user only asks a question (no file work), answer normally without fences.',
    ].join('\n');
  },

  /** Detect “wants files” intent in user text (RU/EN). */
  detectFileIntent(text) {
    const t = String(text || '').toLowerCase();
    if (!t.trim()) return false;
    if (this.detectDeleteIntent(t)) return false;
    const patterns = [
      /\b(создай|создать|сделай|напиши|добавь|поправь|исправь|перепиши|сгенерируй|положи|закинь|запушь|push|commit)\b/i,
      /\b(create|write|add|fix|edit|generate|scaffold|implement|make)\b/i,
      /\b(файл|файлы|папк|директор|проект|репозитор|репо|module|file|folder|directory|repo)\b/i,
      /\.(py|js|ts|tsx|jsx|json|md|html|css|go|rs|java|yml|yaml|toml|sh)\b/i,
    ];
    return patterns.some((re) => re.test(t));
  },

  /** Clear / delete all files in GitHub project. */
  detectDeleteIntent(text) {
    const t = String(text || '').toLowerCase();
    const ru =
      /\b(удали|убери|очисти|сотри|вычисти|снеси)\b/i.test(t) &&
      /\b(файл|файлы|проект|репо|репозитор|вс[её]|content)\b/i.test(t);
    const en =
      /\b(clear|delete|remove|wipe)\b/i.test(t) &&
      /\b(all|files|repo|project|everything)\b/i.test(t);
    const phrase =
      /очисти\s+вс[её]/i.test(t) ||
      /убери\s+все\s+файлы/i.test(t) ||
      /удали\s+все\s+файлы/i.test(t);
    return !!(ru || en || phrase);
  },

  chatMode() {
    try {
      return window.NotionAI.ChatMode?.get?.() || 'chat';
    } catch (_) {
      return 'chat';
    }
  },

  /**
   * GitHub context only. ChatMode.prepareMessages is FINAL authority and will
   * overwrite system prompts — so keep this light and mode-aware.
   * Plan: return messages unchanged (no file-push system).
   */
  prepareMessages(messages) {
    const list = Array.isArray(messages) ? messages.map((m) => ({ ...m })) : [];
    const mode = this.chatMode();
    // Plan must not receive GitHub "write files" system prompt at all
    if (mode === 'plan') return list;
    if (!this.isConfigured()) return list;
    const c = this.load();
    if (c.injectMode === false) return list;

    const sys = this.buildSystemPrompt();
    const withoutSys = list.filter((m) => m.role !== 'system');
    const out = [{ role: 'system', content: sys }, ...withoutSys];

    const appendTag = (content, tag) => {
      if (typeof content === 'string') return content + tag;
      if (Array.isArray(content)) return [...content, { type: 'text', text: tag }];
      return String(content || '') + tag;
    };
    const contentAsText = (content) => {
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .map((p) => (typeof p === 'string' ? p : p?.text || p?.file?.name || ''))
          .join(' ');
      }
      return String(content || '');
    };

    if (mode === 'build') {
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].role === 'user') {
          out[i] = {
            ...out[i],
            content: appendTag(
              out[i].content,
              '\n\n[BRIDGE/BUILD] Output files as ```path/to/file.ext fences. No bare ```python.'
            ),
          };
          break;
        }
      }
    } else if (mode === 'chat') {
      for (let i = out.length - 1; i >= 0; i--) {
        if (out[i].role === 'user') {
          if (this.detectFileIntent(contentAsText(out[i].content))) {
            out[i] = {
              ...out[i],
              content: appendTag(
                out[i].content,
                '\n\n[BRIDGE] If writing files: use ```path/to/file.ext fences only.'
              ),
            };
          }
          break;
        }
      }
    }
    return out;
  },

  refreshSidebarStatus() {
    const el = document.getElementById('ghSidebarStatus');
    if (!el) return;
    if (!this.isConfigured()) {
      el.textContent = 'GitHub: not configured';
      el.className = 'gh-sidebar-status';
      this.refreshBanner();
      return;
    }
    const c = this.load();
    el.textContent = `GitHub: ${this.normalizeRepo(c.repo)} @ ${c.branch || 'main'}`;
    el.className = 'gh-sidebar-status ok';
    this.refreshBanner();
  },

  refreshBanner() {
    let bar = document.getElementById('ghHintBanner');
    if (!this.isConfigured()) {
      if (bar) bar.classList.add('hidden');
      return;
    }
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'ghHintBanner';
      bar.className = 'gh-hint-banner';
      const host = document.querySelector('.main-area') || document.body;
      host.insertBefore(bar, host.firstChild);
    }
    const c = this.load();
    bar.classList.remove('hidden');
    const inject = c.injectMode !== false;
    const auto = c.autoPush === true;
    bar.innerHTML = `<b>GitHub:</b> ${this.normalizeRepo(c.repo)} @ ${c.branch || 'main'} · auto-push=${auto ? 'ON' : 'off'} · <button type="button" id="ghBannerEnsure">Ensure</button> · <button type="button" id="ghBannerClear">Clear repo files</button>`;
    bar.querySelector('#ghBannerEnsure')?.addEventListener('click', async () => {
      try {
        const r = await this.bootstrapRepo();
        alert(
          (r.created ? 'Repo created: ' : 'Repo OK: ') +
            (r.info?.full_name || '') +
            '\nbranch: ' +
            r.branch
        );
        this.refreshSidebarStatus();
      } catch (e) {
        alert(e.message || String(e));
      }
    });
    bar.querySelector('#ghBannerClear')?.addEventListener('click', async () => {
      if (!confirm('Delete ALL files on this branch via GitHub API?')) return;
      try {
        const r = await this.clearRepoFiles();
        alert(`Deleted ${r.deleted} file(s) on ${r.branch}.\nKept/failed: ${r.failed}`);
      } catch (e) {
        alert(e.message || String(e));
      }
    });
  },

  withPrefix(path) {
    const c = this.load();
    let p = String(path || '').replace(/^\/+/, '');
    const pref = (c.prefix || '').replace(/^\/+|\/+$/g, '');
    if (pref && !p.startsWith(pref + '/')) p = pref + '/' + p;
    return p.replace(/\/+/g, '/');
  },

  /** Only real file paths — never invent snippet-1.txt from ```python */
  isPathMeta(meta) {
    const m = String(meta || '').trim().replace(/^["']|["']$/g, '');
    if (!m) return false;
    if (m.includes('/')) return true;
    // file.ext (not language-only keywords)
    if (/\.[a-z0-9]{1,10}$/i.test(m) && !/^(text|plain|bash|shell|sh|zsh|console|output|json|yaml|yml|xml|html|css|js|ts|tsx|jsx|python|py|javascript|typescript|markdown|md|diff|sql|go|rust|java|c|cpp|csharp|cs|php|ruby|rb|toml|ini|env)$/i.test(m)) {
      return true;
    }
    return false;
  },

  resolvePathFromMeta(meta) {
    let m = String(meta || '').trim().replace(/^["']|["']$/g, '');
    if (!m) return { path: '', lang: '' };
    // lang:path
    if (m.includes(':') && !m.startsWith('http')) {
      const parts = m.split(':');
      const maybePath = parts.slice(1).join(':').trim();
      if (this.isPathMeta(maybePath)) {
        return { path: maybePath.replace(/^\/+/, ''), lang: parts[0].trim().toLowerCase() };
      }
    }
    if (this.isPathMeta(m)) {
      return {
        path: m.replace(/^\/+/, ''),
        lang: m.includes('.') ? m.split('.').pop().toLowerCase() : '',
      };
    }
    return { path: '', lang: '' };
  },

  /**
   * Parse file fences with NESTED code blocks support.
   * Problem: README often contains ```bash ... ``` inside ```README.md ... ```.
   * Non-greedy regex stops at the FIRST closing fence → truncated GitHub push.
   * Fix: track fence depth (open with meta = nest++, bare close = nest--).
   */
  parseCodeBlocks(markdown) {
    const src = String(markdown || '').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    const files = [];
    let i = 0;
    let idx = 0;

    const fenceLine = (line) => {
      // opening or closing: ``` or ```` + optional meta
      const m = line.match(/^(`{3,})(.*)$/);
      if (!m) return null;
      return { ticks: m[1], meta: (m[2] || '').trim(), n: m[1].length };
    };

    while (i < lines.length) {
      const open = fenceLine(lines[i]);
      if (!open) {
        i++;
        continue;
      }
      const { path, lang } = this.resolvePathFromMeta(open.meta);
      // Not a project file path → skip whole fence (including nested) via depth
      if (!path) {
        let d = 1;
        i++;
        while (i < lines.length && d > 0) {
          const f = fenceLine(lines[i]);
          if (f) {
            if (!f.meta && f.n >= open.n) d--;
            else if (f.meta) d++;
          }
          i++;
        }
        continue;
      }

      // Collect body with nesting so inner ```bash ... ``` stay inside README
      idx += 1;
      i++;
      const body = [];
      let depth = 1;
      while (i < lines.length && depth > 0) {
        const f = fenceLine(lines[i]);
        if (f) {
          if (!f.meta && f.n >= open.n) {
            depth--;
            if (depth === 0) {
              i++; // consume outer close, do not include in body
              break;
            }
            // inner close — part of file content
            body.push(lines[i]);
            i++;
            continue;
          }
          // nested open (```bash etc.) — part of content
          if (f.meta) {
            depth++;
            body.push(lines[i]);
            i++;
            continue;
          }
        }
        body.push(lines[i]);
        i++;
      }

      let content = body.join('\n');
      // trim single trailing newline noise
      if (content.endsWith('\n')) content = content.slice(0, -1);
      if (!content.trim()) continue;

      files.push({
        path,
        lang: lang || (path.includes('.') ? path.split('.').pop().toLowerCase() : ''),
        content,
        index: idx,
        bytes: new TextEncoder().encode(content).length,
      });
    }
    return files;
  },

  async api(path, options = {}) {
    const c = this.load();
    if (!c.token) throw new Error('GitHub PAT not set. Open Settings.');
    const token = String(c.token).trim();
    const url = path.startsWith('http') ? path : `https://api.github.com${path}`;
    const res = await fetch(url, {
      ...options,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(options.headers || {}),
      },
    });
    let body = null;
    const text = await res.text();
    try {
      body = text ? JSON.parse(text) : null;
    } catch (e) {
      body = { message: text };
    }
    if (!res.ok) {
      const base = body?.message || `GitHub HTTP ${res.status}`;
      let hint = '';
      if (res.status === 401) hint = ' | PAT неверный/отозван';
      else if (res.status === 403) hint = ' | Нет прав (Contents Write / repo scope)';
      else if (res.status === 422)
        hint = ' | ' + (body?.errors ? JSON.stringify(body.errors) : 'validation');
      const err = new Error(`${base} [HTTP ${res.status}]${hint}`);
      err.status = res.status;
      err.body = body;
      throw err;
    }
    return body;
  },

  parseRepo() {
    const c = this.load();
    const normalized = this.normalizeRepo(c.repo);
    const parts = normalized.split('/').filter(Boolean);
    if (parts.length !== 2) {
      throw new Error('Repository must be owner/repo (e.g. YourLogin/your-repo)');
    }
    return {
      owner: parts[0],
      repo: parts[1],
      branch: (c.branch || 'main').trim() || 'main',
    };
  },

  toBase64(str) {
    // Chunked — large README/code won't blow call stack
    const bytes = new TextEncoder().encode(String(str ?? ''));
    const chunk = 0x8000;
    let bin = '';
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return btoa(bin);
  },

  fromBase64(b64) {
    const bin = atob(String(b64 || '').replace(/\n/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  },

  /** Normalize text for git: CRLF/CR → LF (avoids verify length mismatches on Windows). */
  normalizeTextForGit(content) {
    return String(content ?? '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n');
  },

  textsEqualForVerify(local, remote) {
    const a = this.normalizeTextForGit(local);
    const b = this.normalizeTextForGit(remote);
    return a === b;
  },

  /** Same path twice → keep longest (avoids truncated first fence winning). */
  dedupeFilesByPath(files) {
    const map = new Map();
    for (const f of files || []) {
      const p = String(f.path || '').replace(/^\/+/, '');
      if (!p) continue;
      const content = String(f.content ?? '');
      const prev = map.get(p);
      if (!prev || content.length >= String(prev.content || '').length) {
        map.set(p, { ...f, path: p, content });
      }
    }
    return [...map.values()];
  },

  /**
   * Detect shell commands glued on one line (model/stream mangling).
   */
  findCollapsedShellLine(content) {
    return String(content ?? '')
      .split('\n')
      .find((line) => {
        if (line.length < 60) return false;
        const hits = [
          /\bcd\s+/i,
          /\bpip\s+/i,
          /\bnpm\s+/i,
          /\bpython\s+/i,
          /\bpy\s+/i,
          /\bcelery\s+/i,
          /\buvicorn\s+/i,
          /\bdocker\s+/i,
          /\bactivate\b/i,
          /\bgit\s+/i,
          /\bcall\s+/i,
          /\bstart\s+/i,
          /\bcopy\s+/i,
          /\bmkdir\s+/i,
        ].filter((re) => re.test(line)).length;
        return hits >= 3;
      });
  },

  /**
   * Heuristic: insert newlines before common CLI tokens on mangled lines.
   * e.g. "cd backend python -m venv .venv pip install" → multi-line.
   */
  tryFixCollapsedShell(content) {
    const lines = String(content ?? '').split('\n');
    const out = [];
    let changed = false;
    // Split BEFORE these tokens when preceded by space (not start of line)
    const splitRe =
      /\s+(?=(?:cd|python|py|pip|npm|npx|yarn|pnpm|celery|uvicorn|docker|git|call|start|mkdir|copy|xcopy|robocopy|set|echo|conda|poetry|pipenv|node|cargo|go|dotnet|mvn|gradle)\s+|\.venv[/\\]|venv[/\\]|Scripts[/\\]activate|bin\/activate)/gi;

    for (const line of lines) {
      const hits = [
        /\bcd\s+/i,
        /\bpip\s+/i,
        /\bnpm\s+/i,
        /\bpython\s+/i,
        /\bcelery\s+/i,
        /\buvicorn\s+/i,
        /\bdocker\s+/i,
        /\bactivate\b/i,
      ].filter((re) => re.test(line)).length;
      if (line.length >= 60 && hits >= 3) {
        let fixedLine = line
          .replace(/\s*&&\s*/g, '\n')
          .replace(/\s*\|\|\s*/g, '\n')
          // bat: cmd1 & cmd2 (avoid URLs http&)
          .replace(/\s+&\s+/g, '\n')
          .replace(splitRe, '\n');
        const fixed = fixedLine
          .replace(/\n{3,}/g, '\n\n')
          .split('\n')
          .map((l) => l.trimEnd())
          .filter((l) => l.trim().length > 0);
        if (fixed.length > 1) {
          changed = true;
          out.push(...fixed);
          continue;
        }
      }
      out.push(line);
    }
    const result = out.join('\n');
    return { content: result, changed, stillBad: !!this.findCollapsedShellLine(result) };
  },

  /**
   * Pre-push quality checks.
   * hard = block unless force; soft = warn only.
   */
  validateFileContent(path, content) {
    const c = String(content ?? '');
    const hard = [];
    const soft = [];

    if (!c.trim()) hard.push('empty content');
    if (c.length < 3) hard.push('too short');

    if (this.findCollapsedShellLine(c)) {
      hard.push(
        'collapsed newlines (shell commands glued on one line)'
      );
    }

    if (/\bCopy\b\s*$/m.test(c) && c.length < 500) {
      soft.push('possible UI "Copy" leak');
    }

    if (/readme/i.test(path) && c.length < 80) {
      hard.push('README suspiciously short');
    }

    return { hard, soft };
  },

  async getBranchHead(owner, repo, branch) {
    const ref = await this.api(
      `/repos/${owner}/${repo}/git/ref/heads/${branch
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    );
    return ref?.object?.sha;
  },

  /**
   * Atomic multi-file commit via Git Data API (one commit, not N partial PUTs).
   * Then verify each file by re-fetching from Contents API.
   */
  /**
   * @param {Array<{path:string,content:string}>} files
   * @param {string} message
   * @param {{ autoFix?: boolean, force?: boolean }} opts
   *   autoFix — try to un-glue shell lines before validate
   *   force — push even if validation hard-fails
   */
  async pushFilesAtomic(files, message, opts = {}) {
    const autoFix = opts.autoFix !== false; // default try fix
    const force = !!opts.force;
    await this.ensureRepo({ forceCreate: true });
    const { owner, repo } = this.parseRepo();
    const branch = (this.load().branch || 'main').trim() || 'main';
    let list = this.dedupeFilesByPath(
      (files || []).map((f) => ({
        path: this.withPrefix(String(f.path || '').replace(/^\/+/, '')),
        // Always store LF in git — Windows CRLF causes "local=1491 remote=1408" verify fails
        content: this.normalizeTextForGit(f.content),
      }))
    );
    if (!list.length) throw new Error('No files to push');

    const report = [];
    // Auto-fix collapsed shell lines when requested
    if (autoFix) {
      list = list.map((f) => {
        if (!this.findCollapsedShellLine(f.content)) return f;
        const fixed = this.tryFixCollapsedShell(f.content);
        if (fixed.changed) {
          const normalized = this.normalizeTextForGit(fixed.content);
          report.push(
            `auto-fix ${f.path}: split glued shell commands (${f.content.length}→${normalized.length} chars)`
          );
          return { ...f, content: normalized };
        }
        return f;
      });
    }

    // Validate — only hard[] blocks push (unless force)
    for (const f of list) {
      const { hard, soft } = this.validateFileContent(f.path, f.content);
      if (hard.length && !force) {
        const err = new Error(
          `Refused push ${f.path} (${f.content.length} chars):\n- ${hard.join('\n- ')}\n` +
            'Нажми «Fix & push» (авто-разбить строки) или «Force push» (как есть).'
        );
        err.code = 'VALIDATION';
        err.hard = hard;
        err.files = list;
        throw err;
      }
      if (hard.length && force) {
        report.push(`FORCE ${f.path}: ${hard.join('; ')}`);
      }
      if (soft.length) {
        report.push(`warn ${f.path}: ${soft.join('; ')}`);
      }
    }

    // Create blobs once (content fixed); retry only ref/tree/commit on race
    // Map path → expected blob sha for content-addressed verify (no Contents API roundtrip)
    const expectedBlobSha = {};
    const blobEntries = [];
    for (const f of list) {
      const blob = await this.api(`/repos/${owner}/${repo}/git/blobs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: f.content,
          encoding: 'utf-8',
        }),
      });
      expectedBlobSha[f.path] = blob.sha;
      blobEntries.push({
        path: f.path,
        mode: '100644',
        type: 'blob',
        sha: blob.sha,
      });
    }

    const refPath = `/repos/${owner}/${repo}/git/refs/heads/${branch
      .split('/')
      .map(encodeURIComponent)
      .join('/')}`;

    let commit = null;
    let lastErr = null;
    const maxAttempts = force ? 2 : 4;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        // Always re-read tip (fixes "Update is not a fast forward")
        let headSha;
        try {
          headSha = await this.getBranchHead(owner, repo, branch);
        } catch (e) {
          if (e.status === 404) {
            const info = await this.api(`/repos/${owner}/${repo}`);
            const def = info.default_branch || 'main';
            if (def !== branch) {
              await this.createBranch(branch, def, { setWorking: true });
              headSha = await this.getBranchHead(owner, repo, branch);
            } else throw e;
          } else throw e;
        }

        const headCommit = await this.api(
          `/repos/${owner}/${repo}/git/commits/${headSha}`
        );
        const baseTree = headCommit.tree.sha;

        const newTree = await this.api(`/repos/${owner}/${repo}/git/trees`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ base_tree: baseTree, tree: blobEntries }),
        });

        commit = await this.api(`/repos/${owner}/${repo}/git/commits`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: message || `ai: update ${list.length} file(s) [${branch}]`,
            tree: newTree.sha,
            parents: [headSha],
          }),
        });

        // Prefer force on last attempt or when user asked force (lab repos)
        const useForce = force || attempt >= 2;
        try {
          await this.api(refPath, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sha: commit.sha, force: useForce }),
          });
        } catch (e) {
          const msg = String(e.message || '');
          const isNFF =
            e.status === 422 &&
            /fast forward|not a fast.forward|Update is not a fast forward/i.test(msg);
          if (isNFF && attempt < maxAttempts) {
            report.push(`retry ${attempt}/${maxAttempts}: non-fast-forward, re-read HEAD…`);
            await new Promise((r) => setTimeout(r, 200 * attempt));
            lastErr = e;
            continue;
          }
          if (isNFF) {
            await this.api(refPath, {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ sha: commit.sha, force: true }),
            });
            report.push('used force update on branch tip (non-fast-forward)');
          } else {
            throw e;
          }
        }
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        const msg = String(e.message || '');
        if (
          e.status === 422 &&
          /fast forward|not a fast.forward/i.test(msg) &&
          attempt < maxAttempts
        ) {
          report.push(`retry ${attempt}/${maxAttempts}: ${msg.slice(0, 80)}`);
          await new Promise((r) => setTimeout(r, 250 * attempt));
          continue;
        }
        throw e;
      }
    }
    if (lastErr || !commit) {
      throw lastErr || new Error('Push failed: no commit created');
    }

    // VERIFY via commit tree blob SHAs (exact, no Contents API encoding quirks)
    const committed = await this.api(
      `/repos/${owner}/${repo}/git/commits/${commit.sha}`
    );
    const fullTree = await this.api(
      `/repos/${owner}/${repo}/git/trees/${committed.tree.sha}?recursive=1`
    );
    const byPath = {};
    for (const t of fullTree.tree || []) {
      if (t.type === 'blob' && t.path) byPath[t.path] = t.sha;
    }

    const verified = [];
    for (const f of list) {
      const want = expectedBlobSha[f.path];
      const got = byPath[f.path];
      if (!got) {
        throw new Error(
          `Verify failed: ${f.path} not in commit tree ${commit.sha.slice(0, 7)}`
        );
      }
      if (got !== want) {
        throw new Error(
          `Verify failed: ${f.path} blob sha mismatch (want ${want?.slice(0, 7)}, got ${got.slice(0, 7)}). Re-run push.`
        );
      }
      verified.push({
        path: f.path,
        chars: f.content.length,
        blob: got,
        html_url: `https://github.com/${owner}/${repo}/blob/${encodeURIComponent(branch)}/${f.path}`,
        branch,
      });
    }

    // Soft check Contents API (ignore length-only CRLF ghosts; don't fail push)
    try {
      await new Promise((r) => setTimeout(r, 300));
      for (const f of list) {
        const remote = await this.getFileMeta(f.path, branch);
        if (!remote?.sha) continue;
        // Contents "sha" is blob sha — should match
        if (remote.sha !== expectedBlobSha[f.path]) {
          report.push(
            `contents-api lag ${f.path}: tip blob ${remote.sha.slice(0, 7)}≠${expectedBlobSha[f.path].slice(0, 7)} (commit tree OK)`
          );
        }
      }
    } catch (_) {
      /* ignore soft check */
    }

    return {
      branch,
      commit: commit.sha,
      files: verified,
      warnings: report,
      html_url: `https://github.com/${owner}/${repo}/commit/${commit.sha}`,
    };
  },

  sanitizeBranchName(name) {
    let b = String(name || '')
      .trim()
      .replace(/^refs\/heads\//, '');
    b = b.replace(/\s+/g, '-');
    b = b.replace(/[^A-Za-z0-9._\-\/]/g, '-');
    b = b.replace(/\/+/g, '/').replace(/^\/+|\/+$/g, '');
    if (!b || b === 'HEAD') throw new Error('Invalid branch name');
    return b;
  },

  /** Set working branch in localStorage + UI field (if open). */
  setWorkingBranch(branch) {
    const b = this.sanitizeBranchName(branch);
    this.save({ ...this.load(), branch: b });
    const input = document.getElementById('ghBranchInput');
    if (input) input.value = b;
    this.refreshSidebarStatus();
    return b;
  },

  async listBranches() {
    const { owner, repo } = this.parseRepo();
    // paginate lightly
    const names = [];
    let page = 1;
    while (page <= 5) {
      const batch = await this.api(
        `/repos/${owner}/${repo}/branches?per_page=100&page=${page}`
      );
      if (!Array.isArray(batch) || !batch.length) break;
      batch.forEach((br) => {
        if (br?.name) names.push(br.name);
      });
      if (batch.length < 100) break;
      page += 1;
    }
    return names.sort((a, b) => a.localeCompare(b));
  },

  async getBranchSha(branch) {
    const { owner, repo } = this.parseRepo();
    const b = this.sanitizeBranchName(branch);
    const ref = await this.api(
      `/repos/${owner}/${repo}/git/ref/heads/${b
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    );
    const sha = ref?.object?.sha;
    if (!sha) throw new Error(`Cannot get SHA for branch ${b}`);
    return sha;
  },

  /**
   * Create branch from base (default: main / default_branch / current).
   * Then optionally set as working branch.
   */
  async createBranch(newName, fromBranch = '', { setWorking = true } = {}) {
    const { owner, repo } = this.parseRepo();
    const name = this.sanitizeBranchName(newName);

    // resolve base
    let base = (fromBranch || '').trim();
    if (!base) {
      try {
        const info = await this.api(`/repos/${owner}/${repo}`);
        base = info.default_branch || this.load().branch || 'main';
      } catch (_) {
        base = this.load().branch || 'main';
      }
    }
    base = this.sanitizeBranchName(base);

    if (name === base) {
      throw new Error(`Branch ${name} is the same as base`);
    }

    // already exists?
    try {
      await this.getBranchSha(name);
      if (setWorking) this.setWorkingBranch(name);
      return { name, base, created: false, existed: true };
    } catch (e) {
      if (e.status && e.status !== 404) throw e;
    }

    const sha = await this.getBranchSha(base);
    await this.api(`/repos/${owner}/${repo}/git/refs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ref: `refs/heads/${name}`,
        sha,
      }),
    });

    if (setWorking) this.setWorkingBranch(name);
    return { name, base, created: true, existed: false, sha };
  },

  /** Fill datalist suggestions for #ghBranchInput (simple UX). */
  async refreshBranchDatalist() {
    const list = document.getElementById('ghBranchDatalist');
    const input = document.getElementById('ghBranchInput');
    if (!list) return [];
    if (!this.isConfigured()) {
      list.innerHTML = '';
      return [];
    }
    try {
      await this.ensureRepo({ forceCreate: false });
      const names = await this.listBranches();
      list.innerHTML = '';
      names.forEach((n) => {
        const o = document.createElement('option');
        o.value = n;
        list.appendChild(o);
      });
      if (input && !input.value) {
        input.value = this.load().branch || names[0] || 'main';
      }
      return names;
    } catch (e) {
      console.warn('refreshBranchDatalist', e);
      throw e;
    }
  },

  // back-compat alias
  async refreshBranchSelect() {
    return this.refreshBranchDatalist();
  },

  async createRepo(
    name,
    { privateRepo = true, description = 'AI workspace from Notion2API Studio' } = {}
  ) {
    return this.api('/user/repos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        private: !!privateRepo,
        auto_init: true,
        description,
      }),
    });
  },

  async ensureRepo({ forceCreate = false } = {}) {
    const cfg = this.load();
    const { owner, repo } = this.parseRepo();
    const me = await this.api('/user');
    const login = me.login;
    let info = null;
    try {
      info = await this.api(`/repos/${owner}/${repo}`);
    } catch (e) {
      if (e.status !== 404) throw e;
      info = null;
    }

    if (!info) {
      const canCreate = login.toLowerCase() === owner.toLowerCase();
      const auto = cfg.autoCreate !== false || forceCreate;
      if (!canCreate) {
        throw new Error(
          `Repo ${owner}/${repo} не виден токену @${login} (HTTP 404).\n` +
            `• Owner в Settings должен = логин PAT → поставь ${login}/${repo}\n` +
            `• Fine-grained: Repository access → выбери этот repo\n` +
            `• Или https://github.com/new`
        );
      }
      if (!auto && !forceCreate) {
        throw new Error(
          `Repo ${owner}/${repo} не найден. Нажми Ensure repo в Settings.`
        );
      }
      info = await this.createRepo(repo, { privateRepo: cfg.privateRepo !== false });
      await new Promise((r) => setTimeout(r, 900));
      try {
        info = await this.api(`/repos/${owner}/${repo}`);
      } catch (_) {}
      // Keep user's working branch preference; only default when unset
      const defaultBr = info.default_branch || 'main';
      const wantBr = (cfg.branch || defaultBr).trim() || defaultBr;
      this.save({
        ...this.load(),
        branch: wantBr,
        repo: `${login}/${repo}`,
      });
      // If user wanted non-default branch on a fresh repo, create it
      if (wantBr !== defaultBr) {
        try {
          await this.createBranch(wantBr, defaultBr, { setWorking: true });
        } catch (_) {
          /* stay on default until create works */
        }
      }
      this.refreshSidebarStatus();
      return {
        created: true,
        info,
        login,
        branch: this.load().branch || wantBr,
        empty: false,
      };
    }

    // IMPORTANT: never silently fall back to main and overwrite working branch.
    // User's Settings branch is sacred; if missing — create from default.
    const branchCfg = (cfg.branch || info.default_branch || 'main').trim() || 'main';
    const defaultBr = info.default_branch || 'main';
    let empty = false;

    const branchExists = async (b) => {
      try {
        await this.api(
          `/repos/${owner}/${repo}/branches/${encodeURIComponent(b)}`
        );
        return true;
      } catch (e) {
        if (e.status === 404) return false;
        throw e;
      }
    };

    if (await branchExists(branchCfg)) {
      // ok — work on requested branch
    } else if (branchCfg === defaultBr) {
      // default missing → empty repo, seed README on default
      empty = true;
      if (cfg.autoCreate !== false || forceCreate) {
        try {
          await this.api(`/repos/${owner}/${repo}/contents/README.md`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'chore: init repository',
              content: this.toBase64(
                `# ${repo}\n\nAI workspace (Notion2API Studio).\n`
              ),
              branch: defaultBr,
            }),
          });
          empty = false;
          await new Promise((r) => setTimeout(r, 500));
        } catch (_) {}
      }
    } else {
      // requested branch missing → create from default (do NOT switch user to main)
      if (!(await branchExists(defaultBr))) {
        // seed default first
        try {
          await this.api(`/repos/${owner}/${repo}/contents/README.md`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              message: 'chore: init repository',
              content: this.toBase64(
                `# ${repo}\n\nAI workspace (Notion2API Studio).\n`
              ),
              branch: defaultBr,
            }),
          });
          await new Promise((r) => setTimeout(r, 500));
        } catch (_) {}
      }
      try {
        await this.createBranch(branchCfg, defaultBr, { setWorking: true });
      } catch (e) {
        throw new Error(
          `Working branch «${branchCfg}» missing and could not create from «${defaultBr}»: ${e.message}`
        );
      }
    }

    // Do not rewrite cfg.branch to something else
    return {
      created: false,
      info,
      login,
      branch: branchCfg,
      empty,
      permissions: info.permissions || null,
    };
  },

  async resolveBranch() {
    // Always re-read working branch after ensure (createBranch may update it)
    const ens = await this.ensureRepo({ forceCreate: false });
    const working = (this.load().branch || ens.branch || 'main').trim() || 'main';
    return {
      owner: ens.info.owner?.login || this.parseRepo().owner,
      repo: ens.info.name || this.parseRepo().repo,
      branch: working,
      repoInfo: ens.info,
      empty: !!ens.empty,
      login: ens.login,
    };
  },

  async testConnection() {
    const me = await this.api('/user');
    const { owner, repo } = this.parseRepo();
    let listNote = '';
    try {
      const repos = await this.api('/user/repos?per_page=8&sort=updated');
      listNote =
        'token ok, recent: ' +
        ((repos || []).slice(0, 8).map((r) => r.full_name).join(', ') || '(none)');
    } catch (e) {
      listNote = 'list failed: ' + e.message;
    }

    try {
      const ens = await this.ensureRepo({ forceCreate: false });
      return {
        ok: true,
        user: me.login,
        repo: ens.info.full_name || `${owner}/${repo}`,
        private: !!ens.info.private,
        default_branch: ens.info.default_branch,
        branch: ens.branch,
        branchOk: !ens.empty,
        empty: !!ens.empty,
        created: !!ens.created,
        permissions: ens.info.permissions || null,
        ownerMatch: me.login.toLowerCase() === owner.toLowerCase(),
        listNote,
        html_url: ens.info.html_url,
      };
    } catch (e) {
      return {
        ok: false,
        user: me.login,
        repo: `${owner}/${repo}`,
        error: e.message,
        listNote,
        ownerMatch: me.login.toLowerCase() === owner.toLowerCase(),
      };
    }
  },

  async bootstrapRepo() {
    return this.ensureRepo({ forceCreate: true });
  },

  async getFileMeta(path, branch) {
    const { owner, repo } = this.parseRepo();
    const b = branch || this.parseRepo().branch;
    const p = path.replace(/^\/+/, '');
    try {
      return await this.api(
        `/repos/${owner}/${repo}/contents/${p
          .split('/')
          .map(encodeURIComponent)
          .join('/')}?ref=${encodeURIComponent(b)}`
      );
    } catch (e) {
      if (e.status === 404) return null;
      throw e;
    }
  },

  async putFile(path, content, message, { applyPrefix = true, autoFix = true, force = false } = {}) {
    let p = String(path || '').replace(/^\/+/, '');
    if (applyPrefix) p = this.withPrefix(p).replace(/^\/+/, '');
    if (p.endsWith('/')) p = p + '.gitkeep';
    if (!p) throw new Error('Empty file path');
    const result = await this.pushFilesAtomic(
      [{ path: p, content: String(content ?? '') }],
      message || `ai: update ${p}`,
      { autoFix, force }
    );
    const f = result.files[0];
    return {
      path: f.path,
      html_url: f.html_url,
      commit: result.commit,
      updated: true,
      branch: result.branch,
      verified: true,
      chars: f.chars,
    };
  },

  detachPanel(wrapper) {
    const old = wrapper?.querySelector?.('.github-panel');
    if (old) old.remove();
  },

  attachPanel(wrapper, markdownContent) {
    if (!wrapper) return;
    this.detachPanel(wrapper);
    const files = this.parseCodeBlocks(markdownContent);
    const panel = document.createElement('div');
    panel.className = 'github-panel';
    const configured = this.isConfigured();

    const header = document.createElement('div');
    header.className = 'github-panel-header';
    header.innerHTML = `<span>GitHub · ${
      files.length ? files.length + ' file(s) detected' : 'no code blocks'
    }</span>`;
    panel.appendChild(header);

    const body = document.createElement('div');
    body.className = 'github-panel-body';
    panel.appendChild(body);

    if (!files.length) {
      body.innerHTML = `<div class="github-panel-empty">
        Модель должна вывести <b>code fence с путём</b>, не «создать в Notion».<br>
        Кнопка <b>Промпт</b> в баннере сверху подставит шаблон.
      </div>`;
    } else {
      files.forEach((f, i) => {
        const row = document.createElement('div');
        row.className = 'github-file-row';
        row.dataset.index = String(i);
        const suggested = this.withPrefix(f.path);
        row.innerHTML = `
          <div class="github-file-meta"><span>${f.lang || 'file'} · ${
          f.content.length
        } chars · ${(f.bytes || f.content.length)} B</span>
          <label style="display:flex;align-items:center;gap:4px;cursor:pointer"><input type="checkbox" class="gh-file-check" checked> push</label></div>
          <input class="gh-path-input" type="text" value="${suggested
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')}" />
          <div class="github-file-actions">
            <button type="button" class="gh-push-one primary">Push this file</button>
            <button type="button" class="gh-preview">Preview</button>
          </div>`;
        row._fileContent = f.content;
        body.appendChild(row);
        row.querySelector('.gh-push-one').onclick = async () => {
          await this._pushRows([row], panel);
        };
        row.querySelector('.gh-preview').onclick = () => {
          // Full content in a real window — not alert truncation
          const w = window.open('', '_blank', 'width=720,height=640');
          if (!w) {
            alert(f.content.slice(0, 8000) + (f.content.length > 8000 ? '\n…' : ''));
            return;
          }
          w.document.write(
            '<pre style="white-space:pre-wrap;font:12px/1.45 ui-monospace,Consolas,monospace;padding:12px"></pre>'
          );
          w.document.querySelector('pre').textContent = f.content;
          w.document.title = f.path + ' (' + f.content.length + ' chars)';
        };
      });
    }

    const actions = document.createElement('div');
    actions.className = 'github-panel-actions';
    const pushAll = document.createElement('button');
    pushAll.type = 'button';
    pushAll.className = 'primary';
    pushAll.textContent = 'Push selected';
    pushAll.disabled = !files.length;
    pushAll.onclick = async () => {
      const rows = [...panel.querySelectorAll('.github-file-row')].filter(
        (r) => r.querySelector('.gh-file-check')?.checked
      );
      await this._pushRows(rows, panel);
    };
    const ensureBtn = document.createElement('button');
    ensureBtn.type = 'button';
    ensureBtn.textContent = 'Ensure repo';
    ensureBtn.onclick = async () => {
      const status = panel._statusEl;
      if (status) {
        status.textContent = 'Ensuring repo…';
        status.className = 'github-panel-status';
      }
      try {
        const r = await this.bootstrapRepo();
        if (status) {
          status.textContent =
            (r.created ? 'Created ' : 'OK ') +
            (r.info?.full_name || '') +
            ' @ ' +
            r.branch;
          status.className = 'github-panel-status ok';
        }
      } catch (e) {
        if (status) {
          status.textContent = e.message;
          status.className = 'github-panel-status err';
        }
      }
    };
    const openSettings = document.createElement('button');
    openSettings.type = 'button';
    openSettings.textContent = configured ? 'GitHub settings' : 'Configure GitHub…';
    openSettings.onclick = () => window.NotionAI.API.Settings.open();
    actions.appendChild(pushAll);
    actions.appendChild(ensureBtn);
    actions.appendChild(openSettings);
    panel.appendChild(actions);

    const status = document.createElement('div');
    status.className = 'github-panel-status';
    if (!configured) status.textContent = 'Configure PAT + owner/repo in Settings first.';
    panel.appendChild(status);
    panel._statusEl = status;

    const copyRow = wrapper.querySelector('.message-copy-row');
    const host = wrapper.querySelector('.assistant-content') || wrapper;
    if (copyRow) host.insertBefore(panel, copyRow);
    else host.appendChild(panel);

    // Auto-push only in Build (or Chat) — NEVER in Plan
    const cfg = this.load();
    const mode = this.chatMode();
    const allowAuto =
      configured &&
      cfg.autoPush === true &&
      files.length &&
      !wrapper._ghAutoPushed &&
      mode !== 'plan';
    if (allowAuto) {
      wrapper._ghAutoPushed = true;
      const rows = [...panel.querySelectorAll('.github-file-row')];
      this._pushRows(rows, panel).catch((e) => console.warn('auto-push', e));
    } else if (mode === 'plan' && configured) {
      const st = panel._statusEl;
      if (st) {
        st.textContent =
          'Plan mode: auto-push off. Switch to Build to push real files.';
        st.className = 'github-panel-status';
      }
    }
  },

  async listRepoFiles(branch) {
    const { owner, repo } = this.parseRepo();
    const b = (branch || this.load().branch || 'main').trim() || 'main';
    const ref = await this.api(
      `/repos/${owner}/${repo}/git/ref/heads/${b
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`
    );
    const commitSha = ref?.object?.sha;
    if (!commitSha) throw new Error('Cannot resolve branch commit');
    const commit = await this.api(
      `/repos/${owner}/${repo}/git/commits/${commitSha}`
    );
    const treeSha = commit?.tree?.sha;
    if (!treeSha) throw new Error('Cannot resolve tree');
    const tree = await this.api(
      `/repos/${owner}/${repo}/git/trees/${treeSha}?recursive=1`
    );
    return (tree.tree || []).filter((t) => t.type === 'blob' && t.path);
  },

  async deleteFile(path, branch) {
    const { owner, repo } = this.parseRepo();
    const b = (branch || this.load().branch || 'main').trim() || 'main';
    const p = String(path || '').replace(/^\/+/, '');
    const meta = await this.getFileMeta(p, b);
    if (!meta?.sha) return { path: p, deleted: false, reason: 'not found' };
    await this.api(
      `/repos/${owner}/${repo}/contents/${p
        .split('/')
        .map(encodeURIComponent)
        .join('/')}`,
      {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `ai: delete ${p}`,
          sha: meta.sha,
          branch: b,
        }),
      }
    );
    return { path: p, deleted: true };
  },

  /** Delete all files on working branch (real GitHub API — not model fantasy). */
  async clearRepoFiles({ keepReadme = false } = {}) {
    const branch = (this.load().branch || 'main').trim() || 'main';
    const files = await this.listRepoFiles(branch);
    let deleted = 0;
    let failed = 0;
    const errors = [];
    for (const f of files) {
      if (keepReadme && /^readme(\.md)?$/i.test(f.path.split('/').pop() || '')) {
        continue;
      }
      try {
        const r = await this.deleteFile(f.path, branch);
        if (r.deleted) deleted += 1;
        else failed += 1;
      } catch (e) {
        failed += 1;
        errors.push(`${f.path}: ${e.message}`);
      }
    }
    return { branch, deleted, failed, total: files.length, errors };
  },

  _showRecoveryBar(panel, rows, statusEl, errMsg) {
    panel?.querySelector?.('.github-push-recovery')?.remove();
    const bar = document.createElement('div');
    bar.className = 'github-push-recovery';
    bar.innerHTML = `
      <div class="github-recovery-hint">Можно починить и запушить:</div>
      <div class="github-panel-actions" style="padding-top:0">
        <button type="button" class="primary" data-act="fix">Fix &amp; push</button>
        <button type="button" data-act="force">Force push</button>
        <button type="button" data-act="preview">Preview fixed</button>
      </div>`;
    const mount = statusEl?.parentNode || panel;
    if (statusEl?.nextSibling) mount.insertBefore(bar, statusEl.nextSibling);
    else mount.appendChild(bar);

    const run = async (mode) => {
      try {
        if (mode === 'preview') {
          // apply fix in-memory and show first file
          const row = rows[0];
          if (!row) return;
          const raw = row._fileContent || '';
          const fixed = this.tryFixCollapsedShell(raw);
          const text = fixed.changed ? fixed.content : raw;
          const w = window.open('', '_blank', 'width=720,height=640');
          if (!w) {
            alert(text.slice(0, 6000));
            return;
          }
          w.document.title = 'fixed preview';
          w.document.body.innerHTML =
            '<pre style="white-space:pre-wrap;font:12px/1.45 ui-monospace,Consolas,monospace;padding:12px"></pre>';
          w.document.querySelector('pre').textContent =
            (fixed.changed ? '--- AUTO-FIXED ---\n\n' : '--- no change ---\n\n') + text;
          return;
        }
        // Fix & push: always autoFix, then force so we never stick on validation
        // Force push: no fix, skip validation
        await this._pushRows(rows, panel, {
          autoFix: mode === 'fix',
          force: mode === 'force' || mode === 'fix',
          fromRecovery: true,
        });
      } catch (e) {
        console.error('recovery', e);
        if (statusEl) {
          statusEl.textContent = '✗ recovery: ' + (e.message || e);
          statusEl.className = 'github-panel-status err';
        }
      }
    };

    bar.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const btn = e.target.closest('button[data-act]');
      if (!btn) return;
      const act = btn.getAttribute('data-act');
      if (act === 'force') {
        if (!confirm('Force push without validation?')) return;
      }
      run(act);
    });
  },

  async _pushRows(rows, panel, opts = {}) {
    const status = panel?._statusEl || panel?.querySelector('.github-panel-status');
    if (!opts.fromRecovery) {
      panel?.querySelector?.('.github-push-recovery')?.remove();
    }

    if (!this.isConfigured()) {
      if (status) {
        status.textContent = 'GitHub not configured. Open Settings.';
        status.className = 'github-panel-status err';
      }
      return;
    }
    if (!rows.length) {
      if (status) {
        status.textContent = 'No files selected.';
        status.className = 'github-panel-status err';
      }
      return;
    }

    const doFix = opts.autoFix !== false;
    const doForce = !!opts.force;

    if (status) {
      status.textContent = doForce && doFix
        ? 'Fix newlines → force push → verify…'
        : doForce
          ? 'Force push (skip validation) → verify…'
          : 'Auto-fix (if needed) → push → verify…';
      status.className = 'github-panel-status';
    }

    rows.forEach((row) => {
      const btn = row.querySelector('.gh-push-one');
      if (btn) btn.disabled = true;
    });
    panel?.querySelectorAll?.('.github-push-recovery button')?.forEach((b) => {
      b.disabled = true;
    });

    try {
      let fixNotes = [];
      // Always apply content fix when autoFix (including Fix & push recovery)
      if (doFix) {
        rows.forEach((row) => {
          const raw = row._fileContent || '';
          const fixed = this.tryFixCollapsedShell(raw);
          if (fixed.changed) {
            row._fileContent = fixed.content;
            row._fixed = true;
            fixNotes.push(
              `fixed ${ (row.querySelector('.gh-path-input')?.value || '?') }: ${raw.length}→${fixed.content.length} chars` +
                (fixed.stillBad ? ' (still suspicious)' : '')
            );
            const meta = row.querySelector('.github-file-meta span');
            if (meta && !/\bfixed→/.test(meta.textContent || '')) {
              meta.textContent =
                (meta.textContent || '') + ` · fixed→${fixed.content.length}`;
            }
          }
        });
      }

      const files = rows.map((row) => ({
        path: (row.querySelector('.gh-path-input')?.value || '').trim(),
        content: row._fileContent || '',
      }));

      if (!files.some((f) => f.path && f.content)) {
        throw new Error('No path/content on selected rows (panel stale?). Re-send message or push again.');
      }

      const result = await this.pushFilesAtomic(
        files,
        `ai: ${files.map((f) => f.path).join(', ')}`,
        {
          // content already fixed above; skip second pass if we force
          autoFix: doFix && !doForce,
          force: doForce,
        }
      );

      panel?.querySelector?.('.github-push-recovery')?.remove();
      const lines = [
        ...fixNotes.map((n) => `· ${n}`),
        `✓ atomic commit ${result.commit.slice(0, 7)} @ ${result.branch}`,
        result.html_url,
        ...result.files.map((f) => `  ✓ ${f.path} (${f.chars} chars, verified)`),
        ...(result.warnings || []).map((w) => `  ! ${w}`),
      ];
      if (status) {
        status.textContent = lines.join('\n');
        status.className = 'github-panel-status ok';
      }
    } catch (e) {
      console.error('push failed', e);
      if (status) {
        status.textContent = '✗ ' + (e.message || String(e));
        status.className = 'github-panel-status err';
      }
      // Always show recovery (unless already force failed)
      if (!opts.force) {
        this._showRecoveryBar(panel, rows, status, e.message);
      }
    } finally {
      rows.forEach((row) => {
        const btn = row.querySelector('.gh-push-one');
        if (btn) btn.disabled = false;
      });
      panel?.querySelectorAll?.('.github-push-recovery button')?.forEach((b) => {
        b.disabled = false;
      });
    }
  },

  openManualModal(prefill = {}) {
    document.getElementById('ghPushPathInput').value = prefill.path || '';
    document.getElementById('ghPushMsgInput').value = prefill.message || '';
    document.getElementById('ghPushContentInput').value = prefill.content || '';
    const st = document.getElementById('ghPushStatus');
    if (st) {
      st.textContent = '';
      st.className = 'gh-test-status';
    }
    document.getElementById('ghPushModal').classList.remove('hidden');
  },
  closeManualModal() {
    document.getElementById('ghPushModal').classList.add('hidden');
  },
  async confirmManualPush() {
    const st = document.getElementById('ghPushStatus');
    const path = document.getElementById('ghPushPathInput').value.trim();
    const message = document.getElementById('ghPushMsgInput').value.trim();
    const content = document.getElementById('ghPushContentInput').value;
    if (!path) {
      st.textContent = 'Path required';
      st.className = 'gh-test-status err';
      return;
    }
    if (!this.isConfigured()) {
      st.textContent = 'Configure GitHub in Settings first';
      st.className = 'gh-test-status err';
      return;
    }
    st.textContent = 'Validate + atomic commit + verify…';
    st.className = 'gh-test-status';
    try {
      const r = await this.putFile(path, content, message || `ai: ${path}`);
      st.textContent = `OK [${r.branch}] ${r.path} (${r.chars} chars, verified)\n${r.html_url || ''}`;
      st.className = 'gh-test-status ok';
    } catch (e) {
      st.textContent = e.message;
      st.className = 'gh-test-status err';
    }
  },
};
