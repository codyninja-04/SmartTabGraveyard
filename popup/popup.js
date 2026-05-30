import { getAllTabs, searchTabs, deleteTab, getCount } from '../lib/db.js';

const ESTIMATED_MB_PER_TAB = 80;
const MAX_POPUP_TABS = 8;

// ── State ──────────────────────────────────────────────────────────────────

let allTabs = [];
let settings = { threshold: 3, autoArchive: true };

// ── Utils ──────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 0)  return `${d}d ago`;
  if (h > 0)  return `${h}h ago`;
  if (m > 0)  return `${m}m ago`;
  return 'just now';
}

function formatMemory(count) {
  const mb = count * ESTIMATED_MB_PER_TAB;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb} MB`;
}

function domainColor(domain) {
  let h = 0;
  for (const ch of domain) h = (h << 5) - h + ch.charCodeAt(0);
  return `hsl(${Math.abs(h) % 360}, 55%, 32%)`;
}

function createTabItem(tab) {
  const el = document.createElement('div');
  el.className = 'tab-item';
  el.dataset.id = tab.id;
  el.dataset.url = tab.url;

  const initial = (tab.domain?.[0] ?? '?').toUpperCase();
  const bgColor = domainColor(tab.domain || '');

  el.innerHTML = `
    <div class="tab-favicon-wrap">
      <img class="tab-favicon" src="${tab.favicon || ''}" alt="" draggable="false">
      <div class="tab-favicon-fallback" style="background:${bgColor};display:none;align-items:center;justify-content:center;">${initial}</div>
    </div>
    <div class="tab-body">
      <div class="tab-title" title="${escHtml(tab.title)}">${escHtml(tab.title)}</div>
      <div class="tab-meta">
        <span class="tab-domain" title="${escHtml(tab.domain)}">${escHtml(tab.domain)}</span>
        <span class="tab-sep">·</span>
        <span class="tab-time">${timeAgo(tab.archivedAt)}</span>
      </div>
    </div>
    <div class="tab-actions">
      <button class="btn-tab-action btn-restore" title="Restore tab">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9.5h9a4 4 0 010 8H8"/>
          <path d="M7.5 6L4 9.5 7.5 13"/>
        </svg>
      </button>
      <button class="btn-tab-action btn-delete" title="Remove permanently">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 5.5h14M8.5 5.5V4h3v1.5M7 5.5l.75 10.5h5.5L14 5.5"/>
        </svg>
      </button>
    </div>
  `;

  const img = el.querySelector('.tab-favicon');
  const fallback = el.querySelector('.tab-favicon-fallback');

  if (!tab.favicon) {
    img.style.display = 'none';
    fallback.style.display = 'flex';
  } else {
    img.onerror = () => {
      img.style.display = 'none';
      fallback.style.display = 'flex';
    };
  }

  el.querySelector('.btn-restore').addEventListener('click', (e) => {
    e.stopPropagation();
    restoreTab(tab, el);
  });

  el.querySelector('.btn-delete').addEventListener('click', (e) => {
    e.stopPropagation();
    removeTab(tab, el);
  });

  return el;
}

function escHtml(str) {
  return (str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTabs(tabs) {
  const list = document.getElementById('tabList');
  list.innerHTML = '';

  if (tabs.length === 0) {
    const query = document.getElementById('searchInput').value.trim();
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚰️</div>
        <div class="empty-title">${query ? 'No results' : 'Graveyard is empty'}</div>
        <div class="empty-body">${query
          ? `No archived tabs match "${escHtml(query)}"`
          : 'Tabs inactive for more than the threshold will appear here automatically.'
        }</div>
      </div>
    `;
    return;
  }

  const fragment = document.createDocumentFragment();
  const shown = tabs.slice(0, MAX_POPUP_TABS);
  shown.forEach(tab => fragment.appendChild(createTabItem(tab)));

  if (tabs.length > MAX_POPUP_TABS) {
    const more = document.createElement('div');
    more.className = 'section-label';
    more.style.cssText = 'padding:8px 16px 8px;color:var(--text-3);font-size:11px;cursor:pointer;';
    more.textContent = `+${tabs.length - MAX_POPUP_TABS} more — open full graveyard`;
    more.addEventListener('click', openGraveyard);
    fragment.appendChild(more);
  }

  list.appendChild(fragment);
}

function updateSectionLabel(query) {
  document.getElementById('sectionLabel').textContent = query ? 'Results' : 'Recent';
}

function updateStats(count) {
  document.getElementById('statCount').textContent = count;
  document.getElementById('statMemory').textContent = formatMemory(count);
}

// ── Actions ────────────────────────────────────────────────────────────────

async function restoreTab(tab, el) {
  el.style.opacity = '0.5';
  el.style.pointerEvents = 'none';

  const existing = await chrome.tabs.query({ url: tab.url }).catch(() => []);
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: tab.url });
  }

  await deleteTab(tab.id);
  allTabs = allTabs.filter(t => t.id !== tab.id);

  el.remove();
  updateStats(allTabs.length);

  if (document.getElementById('tabList').children.length === 0) {
    renderTabs([]);
  }
}

async function removeTab(tab, el) {
  el.style.opacity = '0.4';
  el.style.transform = 'scale(0.97)';
  el.style.transition = 'opacity 0.15s, transform 0.15s';

  await deleteTab(tab.id);
  allTabs = allTabs.filter(t => t.id !== tab.id);

  setTimeout(() => {
    el.remove();
    updateStats(allTabs.length);
    if (document.getElementById('tabList').children.length === 0) {
      const filtered = getCurrentFiltered();
      renderTabs(filtered);
    }
  }, 150);
}

function getCurrentFiltered() {
  const q = document.getElementById('searchInput').value.trim().toLowerCase();
  if (!q) return allTabs;
  return allTabs.filter(t =>
    t.title?.toLowerCase().includes(q) ||
    t.url?.toLowerCase().includes(q) ||
    t.domain?.toLowerCase().includes(q)
  );
}

async function openGraveyard() {
  const url = chrome.runtime.getURL('graveyard/graveyard.html');
  const existing = await chrome.tabs.query({ url });
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
  window.close();
}

function showToast(msg) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2200);
}

// ── Settings ───────────────────────────────────────────────────────────────

async function loadSettings() {
  const { settings: s = {} } = await chrome.storage.local.get('settings');
  settings = { threshold: 3, autoArchive: true, ...s };
  document.getElementById('thresholdInput').value = settings.threshold;
  const toggle = document.getElementById('toggleAutoArchive');
  toggle.setAttribute('aria-checked', settings.autoArchive.toString());
}

async function saveSettings() {
  await chrome.storage.local.set({ settings });
}

function openSettings() {
  const overlay = document.getElementById('settingsOverlay');
  overlay.classList.remove('hidden');
}

function closeSettings() {
  const overlay = document.getElementById('settingsOverlay');
  overlay.classList.add('hidden');
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  await loadSettings();

  try {
    allTabs = await getAllTabs();
  } catch {
    allTabs = [];
  }

  updateStats(allTabs.length);
  renderTabs(allTabs);

  // Search
  let debounce;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(debounce);
    const q = e.target.value;
    document.getElementById('searchClear').classList.toggle('hidden', !q);
    updateSectionLabel(q);
    debounce = setTimeout(() => renderTabs(getCurrentFiltered()), 180);
  });

  document.getElementById('searchClear').addEventListener('click', () => {
    const input = document.getElementById('searchInput');
    input.value = '';
    input.focus();
    document.getElementById('searchClear').classList.add('hidden');
    updateSectionLabel('');
    renderTabs(allTabs);
  });

  // Open graveyard
  document.getElementById('btnOpenGraveyard').addEventListener('click', openGraveyard);

  // Settings open/close
  document.getElementById('btnSettings').addEventListener('click', openSettings);
  document.getElementById('btnCloseSettings').addEventListener('click', closeSettings);
  document.getElementById('settingsOverlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSettings();
  });

  // Threshold
  document.getElementById('thresholdInput').addEventListener('change', async (e) => {
    const val = Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 3));
    e.target.value = val;
    settings.threshold = val;
    await saveSettings();
  });

  // Auto-archive toggle
  document.getElementById('toggleAutoArchive').addEventListener('click', async (e) => {
    settings.autoArchive = !settings.autoArchive;
    e.currentTarget.setAttribute('aria-checked', settings.autoArchive.toString());
    await saveSettings();
  });

  // Archive now
  document.getElementById('btnArchiveNow').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Archiving…';
    try {
      const response = await chrome.runtime.sendMessage({ type: 'ARCHIVE_NOW' });
      const count = response?.count ?? 0;
      showToast(count > 0 ? `${count} tab${count > 1 ? 's' : ''} archived` : 'No inactive tabs found');
      if (count > 0) {
        allTabs = await getAllTabs();
        updateStats(allTabs.length);
        renderTabs(allTabs);
      }
    } catch {
      showToast('Error running archive');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Archive inactive tabs now';
      closeSettings();
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
