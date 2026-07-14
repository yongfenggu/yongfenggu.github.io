(function () {
  function escapeHtml(s) {
    return String(s)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function toText(content) {
    if (typeof content === 'string') {
      return content.trim();
    }

    if (Array.isArray(content)) {
      const parts = [];
      for (const block of content) {
        if (typeof block === 'string' && block.trim()) {
          parts.push(block.trim());
          continue;
        }
        if (block && typeof block === 'object') {
          const blockType = typeof block.type === 'string' ? block.type : '';
          if (blockType && blockType !== 'text') {
            continue;
          }
          if (typeof block.text === 'string' && block.text.trim()) {
            parts.push(block.text.trim());
            continue;
          }
          if (!blockType && typeof block.content === 'string' && block.content.trim()) {
            parts.push(block.content.trim());
          }
        }
      }
      return parts.join('\n').trim();
    }

    if (content && typeof content === 'object' && typeof content.text === 'string') {
      return content.text.trim();
    }

    return '';
  }

  function extractMessage(row) {
    if (!row || typeof row !== 'object') {
      return null;
    }

    const timestamp = row.timestamp || row.created_at || row.time || null;
    if (['user', 'assistant', 'system'].includes(row.role)) {
      const text = toText(row.content);
      if (text && !shouldSkipMessage(row, row.role, text)) {
        const role = isAutoContinuationSummary(text) ? 'system' : row.role;
        return { role, content: text, timestamp };
      }
    }

    if (['user', 'assistant', 'system'].includes(row.type)) {
      const nested = row.message && typeof row.message === 'object' ? row.message : {};
      const text = toText(nested.content ?? row.content);
      if (text && !shouldSkipMessage(row, row.type, text)) {
        const role = isAutoContinuationSummary(text) ? 'system' : row.type;
        return { role, content: text, timestamp };
      }
    }

    return null;
  }

  function isManagedOpenSpecPrompt(text) {
    return /<!--\s*OPENSPEC:START\s*-->[\s\S]*?<!--\s*OPENSPEC:END\s*-->/i.test(text);
  }

  function shouldSkipMessage(row, role, text) {
    if (row.isMeta === true) {
      return true;
    }
    if (role === 'user' && isManagedOpenSpecPrompt(text)) {
      return true;
    }
    return false;
  }

  function isAutoContinuationSummary(text) {
    return /^This session is being continued from a previous conversation that ran out of context\./i.test(
      text.trim()
    );
  }

  function renderInlineText(text) {
    const chunks = text.split(/(`[^`]+`)/g);
    return chunks
      .map((chunk) => {
        if (chunk.startsWith('`') && chunk.endsWith('`') && chunk.length >= 2) {
          return `<code class="inline-code">${escapeHtml(chunk.slice(1, -1))}</code>`;
        }
        return escapeHtml(chunk);
      })
      .join('');
  }

  function stripImportedLinePrefix(text) {
    return text
      .split('\n')
      .map((line) => line.replace(/^\s*\d+\s*(?:→|->)\s?/, ''))
      .join('\n');
  }

  function normalizeDisplayText(text) {
    return stripImportedLinePrefix(text)
      .replace(/<!--\s*OPENSPEC:START\s*-->[\s\S]*?<!--\s*OPENSPEC:END\s*-->/gi, '')
      .replace(/^\s*ARGUMENTS:\s.*$/gim, '')
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, '')
      .trim();
  }

  function normalizeTitleText(text) {
    return normalizeDisplayText(text)
      .replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/gi, ' ')
      .replace(/<\/?command-[^>]+>/gi, ' ')
      .replace(/<\/?[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function truncateTitle(text, maxLen = 72) {
    if (text.length <= maxLen) {
      return text;
    }
    return `${text.slice(0, maxLen - 3).trimEnd()}...`;
  }

  function looksLikeSlashCommand(text) {
    return /^\/[a-z0-9:_-]+(?:\s+.*)?$/i.test(text);
  }

  function deriveConversationTitle(messages, fallbackTitle) {
    const list = Array.isArray(messages) ? messages : [];
    for (const msg of list) {
      if (!msg || msg.role !== 'user') {
        continue;
      }
      const candidate = normalizeTitleText(msg.content || '');
      if (!candidate || looksLikeSlashCommand(candidate)) {
        continue;
      }
      return truncateTitle(candidate);
    }
    return truncateTitle(String(fallbackTitle || 'untitled'));
  }

  function humanizeProjectName(project) {
    const raw = String(project || '').trim();
    if (!raw || raw === '.') {
      return 'Uncategorized';
    }

    if (raw.includes('/')) {
      const tail = raw.split('/').filter(Boolean).pop() || raw;
      return humanizeProjectName(tail);
    }

    if (!raw.startsWith('-')) {
      return raw;
    }

    const parts = raw.split('-').filter(Boolean);
    if (parts.length === 0) {
      return raw;
    }

    let tail = parts;
    for (let idx = parts.length - 1; idx >= 0; idx -= 1) {
      if (parts[idx].toLowerCase() === 'projects') {
        tail = parts.slice(idx + 1);
        break;
      }
    }

    const categoryWords = new Set([
      'python',
      'node',
      'js',
      'ts',
      'java',
      'go',
      'rust',
      'frontend',
      'backend',
    ]);
    if (tail.length >= 2 && categoryWords.has(tail[0].toLowerCase())) {
      tail = tail.slice(1);
    }

    if (tail.length === 0) {
      return raw;
    }
    return tail.join('-');
  }

  function findLastMessageTimestamp(messages) {
    for (let idx = messages.length - 1; idx >= 0; idx -= 1) {
      const ts = messages[idx]?.timestamp;
      if (typeof ts === 'string' && !Number.isNaN(new Date(ts).valueOf())) {
        return ts;
      }
    }
    return null;
  }

  function buildConversationSearchText(messages, title, displayTitle, project, projectLabel) {
    const parts = [title, displayTitle, project, projectLabel];
    for (const msg of messages || []) {
      const text = normalizeTitleText(msg?.content || '');
      if (text) {
        parts.push(text);
      }
    }
    return parts
      .filter((part) => typeof part === 'string' && part.trim())
      .join('\n')
      .toLowerCase();
  }

  function splitPathSegments(path) {
    return String(path || '')
      .split('/')
      .map((seg) => seg.trim())
      .filter(Boolean);
  }

  function isContainerRootSegment(segment) {
    return ['projects', '.claude', 'claude', 'sessions', 'logs'].includes(segment.toLowerCase());
  }

  function isEncodedClaudeProjectSegment(segment) {
    return /^-users-/i.test(segment);
  }

  function deriveProjectKey(relativePath) {
    const dirs = splitPathSegments(relativePath).slice(0, -1);
    if (dirs.length === 0) {
      return 'Uncategorized';
    }

    const encoded = dirs.find((seg) => isEncodedClaudeProjectSegment(seg));
    if (encoded) {
      return encoded;
    }

    if (dirs.length >= 2 && isContainerRootSegment(dirs[0])) {
      return dirs[1];
    }

    return dirs[0];
  }

  function isSubagentConversation(relativePath) {
    return splitPathSegments(relativePath).some((segment) => segment.toLowerCase() === 'subagents');
  }

  function renderParagraph(lines) {
    const joined = lines.join('\n');
    return `<p>${renderInlineText(joined).replace(/\n/g, '<br>')}</p>`;
  }

  function renderNarrativeBlocks(text) {
    const lines = text.split('\n');
    const out = [];
    const paragraph = [];

    const flushParagraph = () => {
      if (paragraph.length > 0) {
        out.push(renderParagraph(paragraph));
        paragraph.length = 0;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.trimEnd();
      const trimmed = line.trim();

      if (!trimmed) {
        flushParagraph();
        continue;
      }

      const todoMatch = trimmed.match(/^[-*]\s+\[([xX ])\]\s+(.+)$/);
      if (todoMatch) {
        flushParagraph();
        const done = todoMatch[1].toLowerCase() === 'x';
        out.push(
          `<div class="todo-item ${done ? 'done' : 'open'}"><span class="todo-mark">${done ? '✓' : '□'}</span><span class="todo-text">${renderInlineText(todoMatch[2])}</span></div>`
        );
        continue;
      }

      const sectionMatch = trimmed.match(/^#{1,4}\s+(.+)$/);
      if (sectionMatch) {
        flushParagraph();
        out.push(`<div class="section-title">${renderInlineText(sectionMatch[1])}</div>`);
        continue;
      }

      const actionMatch = trimmed.match(/^(Update Todos|Read|Edit|Write|Bash|Run|Search|Open|Click)\b(.*)$/i);
      if (actionMatch) {
        flushParagraph();
        const kind = actionMatch[1];
        const detail = actionMatch[2].trim();
        out.push(
          `<div class="activity-row"><span class="activity-dot"></span><span class="activity-kind">${renderInlineText(kind)}</span>${detail ? `<span class="activity-detail">${renderInlineText(detail)}</span>` : ''}</div>`
        );
        continue;
      }

      paragraph.push(trimmed);
    }

    flushParagraph();
    return out.join('');
  }

  function renderCodeLines(code) {
    const lines = stripImportedLinePrefix(code).split('\n');
    return lines
      .map((line, idx) => {
        const no = idx + 1;
        return `<span class="code-line"><span class="line-no">${no}</span><span class="line-text">${escapeHtml(line)}</span></span>`;
      })
      .join('');
  }

  function renderMessageHtml(content) {
    const text = normalizeDisplayText(typeof content === 'string' ? content : '');
    const pattern = /```([a-zA-Z0-9_-]+)?\n?([\s\S]*?)```/g;
    let cursor = 0;
    let out = '';
    let match;

    while ((match = pattern.exec(text)) !== null) {
      const fullMatch = match[0];
      const rawLang = match[1];
      const codeBody = match[2];
      const start = match.index;
      const before = text.slice(cursor, start);
      if (before) {
        out += renderNarrativeBlocks(before);
      }

      const lang = (rawLang || 'text').toLowerCase();
      const code = codeBody.replace(/^\n/, '').replace(/\n$/, '');
      const lineCount = code === '' ? 1 : code.split('\n').length;
      const isLong = lineCount > 14;
      out += `<div class="code-shell${isLong ? ' is-collapsed' : ''}">`;
      out += '<div class="code-toolbar">';
      out += `<span class="code-lang">${escapeHtml(lang)}</span>`;
      out += '<div class="code-actions">';
      if (isLong) {
        out += '<button type="button" class="toggle-code-btn">Expand</button>';
        out += '<button type="button" class="open-code-modal-btn">View Full</button>';
      }
      out += '<button type="button" class="copy-code-btn">Copy</button>';
      out += '</div>';
      out += '</div>';
      out += `<pre class="code-block"><code class="code-lines">${renderCodeLines(code)}</code></pre>`;
      out += '</div>';
      cursor = start + fullMatch.length;
    }

    const tail = text.slice(cursor);
    if (tail) {
      out += renderNarrativeBlocks(tail);
    }

    return out || '<p></p>';
  }

  function parseJsonlMessages(raw) {
    const lines = raw.split(/\r?\n/);
    const messages = [];

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }

      let row;
      try {
        row = JSON.parse(trimmed);
      } catch {
        continue;
      }

      const message = extractMessage(row);
      if (message) {
        messages.push(message);
      }
    }

    return messages;
  }

  async function buildConversationIndex(fileList) {
    const files = Array.from(fileList || []).filter((file) =>
      file && typeof file.name === 'string' && file.name.toLowerCase().endsWith('.jsonl')
    );

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const raw = await file.text();
          const messages = parseJsonlMessages(raw);
          const relativePath = file.webkitRelativePath || file.name;
          const project = deriveProjectKey(relativePath);
          const title = file.name.replace(/\.jsonl$/i, '');
          const displayTitle = deriveConversationTitle(messages, title);
          const projectLabel = humanizeProjectName(project);
          const lastMessageTimestamp = findLastMessageTimestamp(messages);
          const isSubagent = isSubagentConversation(relativePath);
          const searchText = buildConversationSearchText(messages, title, displayTitle, project, projectLabel);
          return {
            ok: true,
            item: {
              id: relativePath,
              title,
              displayTitle,
              project,
              projectLabel,
              fileName: file.name,
              relativePath,
              lastModified: file.lastModified || 0,
              lastMessageTimestamp,
              isSubagent,
              searchText,
              messageCount: messages.length,
              messages,
            },
          };
        } catch (error) {
          return {
            ok: false,
            error: {
              fileName: file.name,
              relativePath: file.webkitRelativePath || file.name,
              error: error instanceof Error ? error.message : String(error),
            },
          };
        }
      })
    );

    const items = results.filter((r) => r.ok).map((r) => r.item);
    const errors = results.filter((r) => !r.ok).map((r) => r.error);
    items.sort((a, b) => b.lastModified - a.lastModified);
    return { items, errors };
  }

  function groupConversationsByProject(items) {
    const bucket = new Map();
    for (const item of items) {
      const key = item.project || 'Uncategorized';
      if (!bucket.has(key)) {
        bucket.set(key, []);
      }
      bucket.get(key).push(item);
    }

    const grouped = Array.from(bucket.entries()).map(([project, list]) => ({
      project,
      projectLabel: humanizeProjectName(project),
      items: list,
    }));

    grouped.sort((a, b) => {
      if (b.items.length !== a.items.length) {
        return b.items.length - a.items.length;
      }
      return a.projectLabel.localeCompare(b.projectLabel);
    });

    return grouped;
  }

  window.ViewerCore = {
    parseJsonlMessages,
    buildConversationIndex,
    groupConversationsByProject,
    renderMessageHtml,
    deriveConversationTitle,
    humanizeProjectName,
  };
})();
