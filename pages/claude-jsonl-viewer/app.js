const { buildConversationIndex, groupConversationsByProject, renderMessageHtml } = window.ViewerCore;

const folderInput = document.getElementById('folderInput');
const pickFolderBtn = document.getElementById('pickFolderBtn');
const importBtn = document.getElementById('importBtn');
const filterInput = document.getElementById('filterInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const subagentFilter = document.getElementById('subagentFilter');
const conversationList = document.getElementById('conversationList');
const chatTitle = document.getElementById('chatTitle');
const jumpFirstBtn = document.getElementById('jumpFirstBtn');
const jumpLastBtn = document.getElementById('jumpLastBtn');
const messagesEl = document.getElementById('messages');
const pickedPath = document.getElementById('pickedPath');
const importStatus = document.getElementById('importStatus');
const codeModal = document.getElementById('codeModal');
const codeModalBody = document.getElementById('codeModalBody');
const codeModalTitle = document.getElementById('codeModalTitle');
const closeCodeModalBtn = document.getElementById('closeCodeModalBtn');

const CUSTOM_TITLE_STORE_KEY = 'claude-jsonl-viewer.custom-titles.v1';
const SUBAGENT_FILTER_STORE_KEY = 'claude-jsonl-viewer.subagent-filter.v1';
const SUBAGENT_FILTER_MODES = new Set(['main', 'all', 'subagent']);

let allConversations = [];
let activeConversationId = null;
let customTitles = loadCustomTitles();
let subagentFilterMode = loadSubagentFilterMode();
let selectedDirectoryHandle = null;

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function roleLabel(role) {
  if (role === 'user') {
    return 'You';
  }
  if (role === 'assistant') {
    return 'AI';
  }
  return 'SYS';
}

function formatTimestamp(ts) {
  if (!ts) {
    return '';
  }
  const d = new Date(ts);
  if (Number.isNaN(d.valueOf())) {
    return ts;
  }
  return d.toLocaleString();
}

function getCurrentSearchKeyword() {
  return filterInput.value.trim().toLowerCase();
}

function normalizeSearchText(text) {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function escapeRegExp(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderHighlightedText(text, keyword) {
  const source = String(text || '');
  const kw = String(keyword || '').trim();
  if (!kw) {
    return escapeHtml(source);
  }

  const pattern = new RegExp(escapeRegExp(kw), 'ig');
  let result = '';
  let cursor = 0;
  let match = pattern.exec(source);
  while (match) {
    const start = match.index;
    const end = start + match[0].length;
    result += escapeHtml(source.slice(cursor, start));
    result += `<mark class="search-mark">${escapeHtml(source.slice(start, end))}</mark>`;
    cursor = end;
    if (pattern.lastIndex === match.index) {
      pattern.lastIndex += 1;
    }
    match = pattern.exec(source);
  }
  result += escapeHtml(source.slice(cursor));
  return result;
}

function buildContentSnippet(text, keyword) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim();
  const kw = String(keyword || '').trim().toLowerCase();
  if (!raw || !kw) {
    return '';
  }
  const pos = raw.toLowerCase().indexOf(kw);
  if (pos < 0) {
    return '';
  }

  const start = Math.max(0, pos - 26);
  const end = Math.min(raw.length, pos + kw.length + 40);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < raw.length ? '...' : '';
  return `${prefix}${raw.slice(start, end).trim()}${suffix}`;
}

function findFirstMessageSnippet(messages, keyword) {
  if (!keyword) {
    return '';
  }
  for (const message of messages || []) {
    const snippet = buildContentSnippet(message?.content || '', keyword);
    if (snippet) {
      return snippet;
    }
  }
  return '';
}

function findConversationById(conversationId) {
  return allConversations.find((item) => item.id === conversationId) || null;
}

function setImportLoading(isLoading) {
  importBtn.disabled = isLoading;
  pickFolderBtn.disabled = isLoading;
  importBtn.textContent = isLoading ? '載入中...' : '載入對話';
  importStatus.classList.toggle('is-visible', isLoading);
}

function loadCustomTitles() {
  try {
    const raw = localStorage.getItem(CUSTOM_TITLE_STORE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveCustomTitles() {
  try {
    localStorage.setItem(CUSTOM_TITLE_STORE_KEY, JSON.stringify(customTitles));
  } catch {
    // Ignore storage errors in private mode or restricted browsers.
  }
}

function isValidSubagentFilterMode(mode) {
  return SUBAGENT_FILTER_MODES.has(mode);
}

function loadSubagentFilterMode() {
  try {
    const raw = localStorage.getItem(SUBAGENT_FILTER_STORE_KEY);
    if (isValidSubagentFilterMode(raw)) {
      return raw;
    }
  } catch {
    // Ignore storage errors and use default.
  }
  return 'main';
}

function saveSubagentFilterMode() {
  try {
    localStorage.setItem(SUBAGENT_FILTER_STORE_KEY, subagentFilterMode);
  } catch {
    // Ignore storage errors in private mode or restricted browsers.
  }
}

function updateSubagentFilterButtons() {
  if (!subagentFilter) {
    return;
  }

  const buttons = subagentFilter.querySelectorAll('button[data-filter-mode]');
  buttons.forEach((button) => {
    const mode = button.getAttribute('data-filter-mode');
    button.classList.toggle('is-active', mode === subagentFilterMode);
  });
}

function setSubagentFilterMode(mode) {
  if (!isValidSubagentFilterMode(mode) || mode === subagentFilterMode) {
    return;
  }
  subagentFilterMode = mode;
  saveSubagentFilterMode();
  updateSubagentFilterButtons();
  renderFilteredList();
}

function applySubagentFilter(items) {
  if (subagentFilterMode === 'all') {
    return items;
  }

  if (subagentFilterMode === 'subagent') {
    return items.filter((item) => item.isSubagent === true);
  }

  return items.filter((item) => item.isSubagent !== true);
}

function getConversationDisplayTitle(item) {
  const custom = customTitles[item.id];
  if (typeof custom === 'string' && custom.trim()) {
    return custom.trim();
  }
  return item.displayTitle || item.title;
}

function clearConversationCustomTitle(item) {
  if (Object.prototype.hasOwnProperty.call(customTitles, item.id)) {
    delete customTitles[item.id];
    saveCustomTitles();
  }
}

function renameConversation(item) {
  const currentTitle = getConversationDisplayTitle(item);
  const input = window.prompt('輸入自訂對話名稱（留空可還原預設）', currentTitle);
  if (input === null) {
    return;
  }
  const next = input.trim();
  if (!next) {
    clearConversationCustomTitle(item);
  } else {
    customTitles[item.id] = next;
    saveCustomTitles();
  }
  renderFilteredList();
  if (activeConversationId === item.id) {
    chatTitle.textContent = `${getConversationDisplayTitle(item)} (${item.relativePath})`;
  }
}

function clearDirectoryPickerSelection() {
  selectedDirectoryHandle = null;
}

function toFileLike(file, relativePath) {
  return {
    name: file.name,
    lastModified: file.lastModified || 0,
    webkitRelativePath: relativePath,
    async text() {
      return file.text();
    },
  };
}

function canUseShowDirectoryPicker() {
  return window.isSecureContext && typeof window.showDirectoryPicker === 'function';
}

async function walkDirectoryHandle(dirHandle, prefix) {
  const files = [];
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind === 'file') {
      try {
        const file = await entry.getFile();
        files.push(toFileLike(file, `${prefix}${name}`));
      } catch {
        // Skip unreadable files, keep importing the rest.
      }
      continue;
    }

    if (entry.kind === 'directory') {
      try {
        const nested = await walkDirectoryHandle(entry, `${prefix}${name}/`);
        files.push(...nested);
      } catch {
        // Skip unreadable subdirectories.
      }
    }
  }
  return files;
}

async function loadFilesFromDirectoryHandle(dirHandle) {
  if (!dirHandle) {
    return [];
  }
  if (dirHandle.kind !== 'directory') {
    throw new Error('選取目標不是資料夾，請重新選擇。');
  }
  return walkDirectoryHandle(dirHandle, `${dirHandle.name}/`);
}

function scrollMessagesToBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setJumpButtonsEnabled(enabled) {
  jumpFirstBtn.disabled = !enabled;
  jumpLastBtn.disabled = !enabled;
}

function jumpToFirstMessage() {
  const first = messagesEl.querySelector('.chat-row');
  if (first) {
    first.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

function jumpToLastMessage() {
  const last = messagesEl.querySelector('.chat-row:last-child');
  if (last) {
    last.scrollIntoView({ block: 'end', behavior: 'smooth' });
  }
}

function isLongMessage(text) {
  const raw = String(text || '');
  const lineCount = raw.split(/\r?\n/).length;
  return raw.length > 900 || lineCount > 18;
}

function getCodeFromShell(shell) {
  const lineEls = shell?.querySelectorAll('.line-text');
  if (lineEls && lineEls.length > 0) {
    return Array.from(lineEls).map((el) => el.textContent || '').join('\n');
  }
  return shell?.querySelector('code')?.textContent || '';
}

function openCodeModal(code, lang) {
  codeModalTitle.textContent = `Code Preview (${lang || 'text'})`;
  codeModalBody.textContent = code;
  codeModal.classList.add('is-open');
  codeModal.setAttribute('aria-hidden', 'false');
}

function closeCodeModal() {
  codeModal.classList.remove('is-open');
  codeModal.setAttribute('aria-hidden', 'true');
}

async function copyCode(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = 'Copied';
    setTimeout(() => {
      button.textContent = old;
    }, 1200);
  } catch {
    const area = document.createElement('textarea');
    area.value = text;
    document.body.appendChild(area);
    area.select();
    document.execCommand('copy');
    document.body.removeChild(area);
  }
}

function renderMessages(messages, options = {}) {
  const searchKeyword = String(options.searchKeyword || '').trim().toLowerCase();
  const focusFirstMatch = options.focusFirstMatch === true;
  messagesEl.innerHTML = '';
  if (!messages.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '此對話沒有可顯示訊息';
    messagesEl.appendChild(empty);
    setJumpButtonsEnabled(false);
    return;
  }

  let firstMatchRow = null;

  messages.forEach((m) => {
    const row = document.createElement('article');
    row.className = `chat-row ${m.role || 'assistant'}`;
    if (m.role === 'assistant') {
      row.classList.add('assistant-log');
    }
    const messageText = normalizeSearchText(m.content || '');
    if (searchKeyword && messageText.includes(searchKeyword)) {
      row.classList.add('search-hit');
      if (!firstMatchRow) {
        firstMatchRow = row;
      }
    }

    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = roleLabel(m.role);

    const bubble = document.createElement('div');
    bubble.className = 'message-bubble';

    const meta = document.createElement('div');
    meta.className = 'meta';
    const ts = formatTimestamp(m.timestamp);
    meta.textContent = ts ? `${roleLabel(m.role)} · ${ts}` : `${roleLabel(m.role)}`;

    const body = document.createElement('div');
    body.className = 'message-body';
    body.innerHTML = renderMessageHtml(m.content || '');

    bubble.appendChild(meta);
    bubble.appendChild(body);

    if (isLongMessage(m.content) && m.role === 'user') {
      row.classList.add('collapsed-message');
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'toggle-message-btn';
      toggle.textContent = 'View Full';
      toggle.addEventListener('click', () => {
        row.classList.toggle('collapsed-message');
        toggle.textContent = row.classList.contains('collapsed-message') ? 'View Full' : 'Collapse';
      });
      bubble.appendChild(toggle);
    }

    row.appendChild(avatar);
    row.appendChild(bubble);
    messagesEl.appendChild(row);
  });

  setJumpButtonsEnabled(true);
  if (focusFirstMatch && firstMatchRow) {
    firstMatchRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return;
  }
  scrollMessagesToBottom();
}

function clearActiveConversation() {
  for (const el of conversationList.querySelectorAll('.conversation-item')) {
    el.classList.remove('active');
  }
}

function renderConversations(items) {
  conversationList.innerHTML = '';
  const searchKeyword = getCurrentSearchKeyword();

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.textContent = '沒有找到 JSONL 對話';
    conversationList.appendChild(empty);
    return;
  }

  const groups = groupConversationsByProject(items);
  groups.forEach((group) => {
    const section = document.createElement('section');
    section.className = 'project-group';

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'project-header';
    header.title = group.project;
    header.innerHTML = `<span>${escapeHtml(group.projectLabel || group.project)}</span><span class="project-count">${group.items.length}</span>`;
    header.addEventListener('click', () => {
      section.classList.toggle('collapsed');
    });

    const list = document.createElement('div');
    list.className = 'project-items';

    group.items.forEach((item) => {
      const row = document.createElement('div');
      row.className = 'conversation-row';

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'conversation-item';
      if (item.id === activeConversationId) {
        btn.classList.add('active');
      }
      const metaParts = [];
      const timeMarker = item.lastMessageTimestamp || item.lastModified || null;
      if (timeMarker) {
        metaParts.push(formatTimestamp(timeMarker));
      }
      metaParts.push(`${item.messageCount} messages`);
      const snippet = searchKeyword ? findFirstMessageSnippet(item.messages, searchKeyword) : '';
      const snippetHtml = snippet
        ? `<div class="search-snippet">${renderHighlightedText(snippet, searchKeyword)}</div>`
        : '';
      btn.innerHTML = `<div class="conversation-title">${escapeHtml(getConversationDisplayTitle(item))}</div>${snippetHtml}<div class="meta">${escapeHtml(metaParts.join(' · '))}</div>`;
      btn.addEventListener('click', () => {
        activeConversationId = item.id;
        clearActiveConversation();
        btn.classList.add('active');
        chatTitle.textContent = `${getConversationDisplayTitle(item)} (${item.relativePath})`;
        renderMessages(item.messages, {
          searchKeyword,
          focusFirstMatch: Boolean(searchKeyword),
        });
      });
      btn.addEventListener('dblclick', () => {
        renameConversation(item);
      });

      const renameBtn = document.createElement('button');
      renameBtn.type = 'button';
      renameBtn.className = 'rename-conversation-btn';
      renameBtn.textContent = '改名';
      renameBtn.title = '手動改名';
      renameBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        renameConversation(item);
      });

      row.appendChild(btn);
      row.appendChild(renameBtn);
      list.appendChild(row);
    });

    section.appendChild(header);
    section.appendChild(list);
    conversationList.appendChild(section);
  });
}

function renderFilteredList() {
  const nonEmpty = allConversations.filter((c) => c.messageCount > 0);
  const byMode = applySubagentFilter(nonEmpty);
  const kw = filterInput.value.trim().toLowerCase();
  const filtered = kw
      ? byMode.filter((c) =>
          getConversationDisplayTitle(c).toLowerCase().includes(kw) ||
          c.project.toLowerCase().includes(kw) ||
          (c.projectLabel || '').toLowerCase().includes(kw) ||
          (c.searchText || '').includes(kw)
      )
    : byMode;
  renderConversations(filtered);
}

function rerenderActiveConversationForSearch(focusFirstMatch) {
  if (!activeConversationId) {
    return;
  }
  const activeItem = findConversationById(activeConversationId);
  if (!activeItem) {
    return;
  }
  chatTitle.textContent = `${getConversationDisplayTitle(activeItem)} (${activeItem.relativePath})`;
  renderMessages(activeItem.messages, {
    searchKeyword: getCurrentSearchKeyword(),
    focusFirstMatch: focusFirstMatch === true,
  });
}

async function importFolder() {
  const hasPickerHandle = Boolean(selectedDirectoryHandle);
  const hasInputFiles = folderInput.files && folderInput.files.length > 0;
  if (!hasInputFiles && !hasPickerHandle) {
    alert('請先選擇資料夾，再載入對話。');
    return;
  }

  setImportLoading(true);
  await new Promise((resolve) => requestAnimationFrame(resolve));

  try {
    let files = [];
    let rootHint = 'selected folder';

    if (hasPickerHandle) {
      files = await loadFilesFromDirectoryHandle(selectedDirectoryHandle);
      rootHint = selectedDirectoryHandle?.name || 'selected folder';
    } else {
      files = Array.from(folderInput.files || []);
      const firstPath = files[0]?.webkitRelativePath || '';
      rootHint = firstPath.includes('/') ? firstPath.split('/')[0] : 'selected folder';
    }

    if (files.length === 0) {
      alert('選到的資料夾沒有可讀取檔案。');
      return;
    }

    const result = await buildConversationIndex(files);
    allConversations = result.items;
    const nonEmptyCount = allConversations.filter((c) => c.messageCount > 0).length;
    const skipped = result.errors.length;
    pickedPath.textContent = skipped > 0
      ? `Imported: ${rootHint} (${nonEmptyCount} conversations, skipped ${skipped} unreadable files)`
      : `Imported: ${rootHint} (${nonEmptyCount} conversations)`;
    renderFilteredList();

    activeConversationId = null;
    chatTitle.textContent = '選擇左側對話';
    messagesEl.innerHTML = '';
    setJumpButtonsEnabled(false);
  } finally {
    setImportLoading(false);
  }
}

pickFolderBtn.addEventListener('click', () => {
  const openFallbackInput = () => {
    clearDirectoryPickerSelection();
    folderInput.click();
  };

  if (!canUseShowDirectoryPicker()) {
    openFallbackInput();
    return;
  }

  window
    .showDirectoryPicker({
      id: 'claude-jsonl-viewer-folder',
      mode: 'read',
    })
    .then((handle) => {
      if (!handle) {
        return;
      }
      clearDirectoryPickerSelection();
      selectedDirectoryHandle = handle;
      folderInput.value = '';
      pickedPath.textContent = `已選擇資料夾：${handle.name}（點「載入對話」開始解析）`;
    })
    .catch((error) => {
      if (error?.name === 'AbortError') {
        return;
      }
      openFallbackInput();
    });
});

folderInput.addEventListener('change', () => {
  if (!folderInput.files || folderInput.files.length === 0) {
    return;
  }
  clearDirectoryPickerSelection();
  const firstPath = folderInput.files[0]?.webkitRelativePath || '';
  const rootHint = firstPath.includes('/') ? firstPath.split('/')[0] : 'selected folder';
  pickedPath.textContent = `已選擇資料夾：${rootHint}（點「載入對話」開始解析）`;
});

importBtn.addEventListener('click', () => {
  importFolder().catch((err) => {
    alert(err.message || 'Import 失敗');
  });
});

messagesEl.addEventListener('click', (event) => {
  const toggleBtn = event.target.closest('.toggle-code-btn');
  if (toggleBtn) {
    const shell = toggleBtn.closest('.code-shell');
    if (shell) {
      shell.classList.toggle('is-collapsed');
      toggleBtn.textContent = shell.classList.contains('is-collapsed') ? 'Expand' : 'Collapse';
    }
    return;
  }

  const openBtn = event.target.closest('.open-code-modal-btn');
  if (openBtn) {
    const shell = openBtn.closest('.code-shell');
    const code = getCodeFromShell(shell);
    const lang = shell?.querySelector('.code-lang')?.textContent || 'text';
    openCodeModal(code, lang);
    return;
  }

  const button = event.target.closest('.copy-code-btn');
  if (!button) {
    return;
  }

  const shell = button.closest('.code-shell');
  const code = getCodeFromShell(shell);
  copyCode(code, button);
});

filterInput.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') {
    return;
  }
  event.preventDefault();
  renderFilteredList();
  rerenderActiveConversationForSearch(true);
});
clearSearchBtn.addEventListener('click', () => {
  filterInput.value = '';
  renderFilteredList();
  rerenderActiveConversationForSearch(false);
  filterInput.focus();
});
if (subagentFilter) {
  subagentFilter.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter-mode]');
    if (!button) {
      return;
    }
    const mode = button.getAttribute('data-filter-mode');
    setSubagentFilterMode(mode);
  });
}
jumpFirstBtn.addEventListener('click', jumpToFirstMessage);
jumpLastBtn.addEventListener('click', jumpToLastMessage);
closeCodeModalBtn.addEventListener('click', closeCodeModal);
codeModal.addEventListener('click', (event) => {
  if (event.target.matches('[data-close-modal=\"1\"]')) {
    closeCodeModal();
  }
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && codeModal.classList.contains('is-open')) {
    closeCodeModal();
  }
});

updateSubagentFilterButtons();
