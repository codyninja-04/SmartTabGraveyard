import {
  getAllTabs,
  deleteTab,
  deleteTabs,
  deleteAllTabs,
  getDomains,
} from '../lib/db.js';

const ESTIMATED_MB_PER_TAB = 80;

// ── State ──────────────────────────────────────────────────────────────────

let allTabs = [];
let filtered = [];
let selectedIds = new Set();
let activeDomain = null;
let activeTime = 'all';
let searchQuery = '';

// ── Utils ──────────────────────────────────────────────────────────────────

function esc(str) {
  return (str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (d > 30) return new Date(ts).toLocaleDateString();
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

function timeFilter(tab) {
  if (activeTime === 'all') return true;
  const diff = Date.now() - tab.archivedAt;
  if (activeTime === 'today')  return diff < 86_400_000;
  if (activeTime === 'week')   return diff < 7 * 86_400_000;
  if (activeTime === 'month')  return diff < 30 * 86_400_000;
  return true;
}

function applyFilters() {
  const q = searchQuery.toLowerCase().trim();
  filtered = allTabs.filter(tab => {
    if (!timeFilter(tab)) return false;
    if (activeDomain && tab.domain !== activeDomain) return false;
    if (!q) return true;
    return (
      tab.title?.toLowerCase().includes(q) ||
      tab.url?.toLowerCase().includes(q) ||
      tab.domain?.toLowerCase().includes(q)
    );
  });
}

// ── Render ─────────────────────────────────────────────────────────────────

function createRow(tab) {
  const row = document.createElement('div');
  row.className = 'tab-row';
  if (selectedIds.has(tab.id)) row.classList.add('selected');
  row.dataset.id = tab.id;

  const initial = (tab.domain?.[0] ?? '?').toUpperCase();
  const bg = domainColor(tab.domain || '');
  const hasFav = tab.favicon && !tab.favicon.startsWith('chrome');

  row.innerHTML = `
    <div class="row-check">
      <input type="checkbox" class="row-checkbox" ${selectedIds.has(tab.id) ? 'checked' : ''} aria-label="Select tab">
    </div>
    <div class="row-favicon">
      <img class="tab-favicon${hasFav ? '' : ' hidden'}" src="${hasFav ? esc(tab.favicon) : ''}" alt="" draggable="false">
      <div class="favicon-fallback${hasFav ? ' hidden' : ''}" style="background:${bg};display:${hasFav ? 'none' : 'flex'};align-items:center;justify-content:center;">${initial}</div>
    </div>
    <div class="row-info">
      <a class="row-title" href="${esc(tab.url)}" target="_blank" title="${esc(tab.title)}">${esc(tab.title)}</a>
      <div class="row-url" title="${esc(tab.url)}">${esc(tab.url)}</div>
    </div>
    <div class="row-domain">
      <span class="domain-badge" title="${esc(tab.domain)}">${esc(tab.domain)}</span>
    </div>
    <div class="row-archived">
      <span class="archived-time">${timeAgo(tab.archivedAt)}</span>
      ${tab.lastActiveAt ? `<span class="last-active-time">active ${timeAgo(tab.lastActiveAt)}</span>` : ''}
    </div>
    <div class="row-actions">
      <button class="btn-row-action btn-row-restore" title="Restore tab">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 9.5h9a4 4 0 010 8H8"/>
          <path d="M7.5 6L4 9.5 7.5 13"/>
        </svg>
      </button>
      <button class="btn-row-action btn-row-delete" title="Delete permanently">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 5.5h14M8.5 5.5V4h3v1.5M7 5.5l.75 10.5h5.5L14 5.5"/>
        </svg>
      </button>
    </div>
  `;

  // Favicon fallback
  if (hasFav) {
    const img = row.querySelector('.tab-favicon');
    const fallback = row.querySelector('.favicon-fallback');
    img.onerror = () => {
      img.style.display = 'none';
      fallback.style.display = 'flex';
    };
  }

  // Checkbox
  row.querySelector('.row-checkbox').addEventListener('change', (e) => {
    const id = tab.id;
    if (e.target.checked) {
      selectedIds.add(id);
      row.classList.add('selected');
    } else {
      selectedIds.delete(id);
      row.classList.remove('selected');
    }
    updateBulkBar();
  });

  // Restore
  row.querySelector('.btn-row-restore').addEventListener('click', () => restoreSingle(tab, row));

  // Delete
  row.querySelector('.btn-row-delete').addEventListener('click', () => deleteSingle(tab, row));

  return row;
}

function renderRows() {
  const body = document.getElementById('tabTableBody');
  body.innerHTML = '';

  if (filtered.length === 0) {
    const q = searchQuery.trim();
    body.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚰️</div>
        <div class="empty-title">${q || activeDomain ? 'No results' : 'Graveyard is empty'}</div>
        <div class="empty-body">${
          q
            ? `No archived tabs match "${esc(q)}"`
            : activeDomain
              ? `No archived tabs from <strong>${esc(activeDomain)}</strong>`
              : 'Tabs inactive beyond your threshold will automatically appear here.'
        }</div>
      </div>
    `;
    document.getElementById('resultCount').textContent = '';
    return;
  }

  const frag = document.createDocumentFragment();
  filtered.forEach(tab => frag.appendChild(createRow(tab)));
  body.appendChild(frag);

  document.getElementById('resultCount').textContent =
    `Showing ${filtered.length} of ${allTabs.length} archived tab${allTabs.length !== 1 ? 's' : ''}`;
}

function renderSidebar() {
  document.getElementById('sidebarCount').textContent = allTabs.length;
  document.getElementById('sidebarMemory').textContent = formatMemory(allTabs.length);

  const oldest = allTabs.length > 0 ? allTabs[allTabs.length - 1] : null;
  document.getElementById('sidebarOldest').textContent = oldest ? timeAgo(oldest.archivedAt) : '—';
}

async function renderDomainList() {
  const domains = await getDomains();
  const container = document.getElementById('domainList');
  container.innerHTML = '';

  const allBtn = document.createElement('button');
  allBtn.className = 'domain-btn' + (activeDomain === null ? ' active' : '');
  allBtn.innerHTML = `<span class="domain-name">All domains</span><span class="domain-count">${allTabs.length}</span>`;
  allBtn.addEventListener('click', () => {
    activeDomain = null;
    renderDomainList();
    applyFilters();
    renderRows();
    updateHeaderCheckbox();
  });
  container.appendChild(allBtn);

  for (const { domain, count } of domains) {
    const btn = document.createElement('button');
    btn.className = 'domain-btn' + (activeDomain === domain ? ' active' : '');
    btn.innerHTML = `<span class="domain-name" title="${esc(domain)}">${esc(domain)}</span><span class="domain-count">${count}</span>`;
    btn.addEventListener('click', () => {
      activeDomain = domain;
      renderDomainList();
      applyFilters();
      renderRows();
      updateHeaderCheckbox();
    });
    container.appendChild(btn);
  }
}

function updateBulkBar() {
  const bar = document.getElementById('bulkBar');
  const label = document.getElementById('bulkLabel');
  if (selectedIds.size > 0) {
    bar.classList.remove('hidden');
    label.textContent = `${selectedIds.size} selected`;
  } else {
    bar.classList.add('hidden');
  }
  updateHeaderCheckbox();
}

function updateHeaderCheckbox() {
  const hdr = document.getElementById('headerCheckbox');
  const visibleIds = filtered.map(t => t.id);
  if (visibleIds.length === 0) {
    hdr.checked = false;
    hdr.indeterminate = false;
  } else {
    const allChecked = visibleIds.every(id => selectedIds.has(id));
    const someChecked = visibleIds.some(id => selectedIds.has(id));
    hdr.checked = allChecked;
    hdr.indeterminate = someChecked && !allChecked;
  }
}

// ── Actions ────────────────────────────────────────────────────────────────

async function restoreSingle(tab, row) {
  row.style.opacity = '0.4';
  row.style.pointerEvents = 'none';

  const existing = await chrome.tabs.query({ url: tab.url }).catch(() => []);
  if (existing.length > 0) {
    await chrome.tabs.update(existing[0].id, { active: true });
    await chrome.windows.update(existing[0].windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url: tab.url });
  }

  await deleteTab(tab.id);
  allTabs = allTabs.filter(t => t.id !== tab.id);
  selectedIds.delete(tab.id);

  applyFilters();
  renderRows();
  renderSidebar();
  await renderDomainList();
  updateBulkBar();
}

async function deleteSingle(tab, row) {
  row.style.opacity = '0';
  row.style.transition = 'opacity 0.15s';
  await new Promise(r => setTimeout(r, 150));

  await deleteTab(tab.id);
  allTabs = allTabs.filter(t => t.id !== tab.id);
  selectedIds.delete(tab.id);

  applyFilters();
  renderRows();
  renderSidebar();
  await renderDomainList();
  updateBulkBar();
}

async function restoreBulk() {
  const ids = [...selectedIds];
  const tabs = allTabs.filter(t => ids.includes(t.id));

  for (const tab of tabs) {
    const existing = await chrome.tabs.query({ url: tab.url }).catch(() => []);
    if (existing.length > 0) {
      await chrome.tabs.update(existing[0].id, { active: true });
    } else {
      await chrome.tabs.create({ url: tab.url });
    }
  }

  await deleteTabs(ids);
  allTabs = allTabs.filter(t => !ids.includes(t.id));
  selectedIds.clear();

  applyFilters();
  renderRows();
  renderSidebar();
  await renderDomainList();
  updateBulkBar();
}

async function deleteBulk() {
  const ids = [...selectedIds];
  await deleteTabs(ids);
  allTabs = allTabs.filter(t => !ids.includes(t.id));
  selectedIds.clear();

  applyFilters();
  renderRows();
  renderSidebar();
  await renderDomainList();
  updateBulkBar();
}

function exportBookmarks() {
  const rows = filtered.map(tab => {
    const d = new Date(tab.archivedAt).toUTCString();
    return `    <DT><A HREF="${esc(tab.url)}" ADD_DATE="${Math.floor(tab.archivedAt / 1000)}">${esc(tab.title)}</A>`;
  }).join('\n');

  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">
<TITLE>Smart Tab Graveyard Export</TITLE>
<H1>Smart Tab Graveyard</H1>
<DL><p>
  <DT><H3>Archived Tabs</H3>
  <DL><p>
${rows}
  </DL><p>
</DL>`;

  const blob = new Blob([html], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `graveyard-export-${new Date().toISOString().slice(0, 10)}.html`;
  a.click();
  URL.revokeObjectURL(url);
}

// ── Confirm modal ──────────────────────────────────────────────────────────

function confirm(title, body, onConfirm) {
  const overlay = document.getElementById('confirmModal');
  document.getElementById('modalTitle').textContent = title;
  document.getElementById('modalBody').textContent = body;
  overlay.classList.remove('hidden');

  const cancel = document.getElementById('modalCancel');
  const confirmBtn = document.getElementById('modalConfirm');

  const close = () => overlay.classList.add('hidden');

  cancel.onclick = close;
  overlay.onclick = (e) => { if (e.target === overlay) close(); };
  confirmBtn.onclick = () => { close(); onConfirm(); };
}

// ── Init ───────────────────────────────────────────────────────────────────

async function init() {
  try {
    allTabs = await getAllTabs();
  } catch {
    allTabs = [];
  }

  applyFilters();
  renderRows();
  renderSidebar();
  await renderDomainList();

  // Search
  let debounce;
  document.getElementById('searchInput').addEventListener('input', (e) => {
    clearTimeout(debounce);
    searchQuery = e.target.value;
    document.getElementById('searchClear').classList.toggle('hidden', !searchQuery);
    debounce = setTimeout(() => {
      applyFilters();
      renderRows();
      updateHeaderCheckbox();
    }, 200);
  });

  document.getElementById('searchClear').addEventListener('click', () => {
    document.getElementById('searchInput').value = '';
    searchQuery = '';
    document.getElementById('searchClear').classList.add('hidden');
    applyFilters();
    renderRows();
    updateHeaderCheckbox();
  });

  // Time filter buttons
  document.getElementById('timeFilters').addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;
    activeTime = btn.dataset.filter;
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    applyFilters();
    renderRows();
    updateHeaderCheckbox();
  });

  // Header checkbox (select/deselect all visible)
  document.getElementById('headerCheckbox').addEventListener('change', (e) => {
    const visibleIds = filtered.map(t => t.id);
    if (e.target.checked) {
      visibleIds.forEach(id => selectedIds.add(id));
    } else {
      visibleIds.forEach(id => selectedIds.delete(id));
    }
    // Re-render to update row checkboxes
    renderRows();
    updateBulkBar();
  });

  // Select all inside bulk bar
  document.getElementById('selectAll').addEventListener('change', (e) => {
    const visibleIds = filtered.map(t => t.id);
    if (e.target.checked) visibleIds.forEach(id => selectedIds.add(id));
    else visibleIds.forEach(id => selectedIds.delete(id));
    renderRows();
    updateBulkBar();
  });

  // Bulk restore
  document.getElementById('btnBulkRestore').addEventListener('click', () => {
    const count = selectedIds.size;
    confirm(
      'Restore tabs',
      `Restore ${count} tab${count > 1 ? 's' : ''}? They will be opened and removed from the graveyard.`,
      restoreBulk
    );
  });

  // Bulk delete
  document.getElementById('btnBulkDelete').addEventListener('click', () => {
    const count = selectedIds.size;
    confirm(
      'Delete permanently',
      `Delete ${count} tab${count > 1 ? 's' : ''}? This cannot be undone.`,
      deleteBulk
    );
  });

  // Clear all
  document.getElementById('btnClearAll').addEventListener('click', () => {
    confirm(
      'Clear entire graveyard',
      `This will permanently delete all ${allTabs.length} archived tabs. This cannot be undone.`,
      async () => {
        await deleteAllTabs();
        allTabs = [];
        selectedIds.clear();
        applyFilters();
        renderRows();
        renderSidebar();
        await renderDomainList();
        updateBulkBar();
      }
    );
  });

  // Export
  document.getElementById('btnExport').addEventListener('click', exportBookmarks);
}

document.addEventListener('DOMContentLoaded', init);
