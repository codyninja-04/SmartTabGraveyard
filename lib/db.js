const DB_NAME = 'SmartTabGraveyard';
const DB_VERSION = 1;
const STORE = 'archivedTabs';
const MAX_BYTES = 50 * 1024 * 1024;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = ({ target: { result: db } }) => {
      const store = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      store.createIndex('url', 'url', { unique: false });
      store.createIndex('domain', 'domain', { unique: false });
      store.createIndex('archivedAt', 'archivedAt', { unique: false });
    };

    req.onsuccess = ({ target: { result: db } }) => {
      _db = db;
      _db.onversionchange = () => { _db.close(); _db = null; };
      resolve(_db);
    };

    req.onerror = ({ target: { error } }) => reject(error);
  });
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getTabByUrl(url) {
  const db = await open();
  const tx = db.transaction(STORE, 'readonly');
  return wrap(tx.objectStore(STORE).index('url').get(url));
}

export async function addTab(tab) {
  const existing = await getTabByUrl(tab.url);
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  if (existing) {
    return wrap(store.put({ ...existing, ...tab, id: existing.id }));
  }
  return wrap(store.add(tab));
}

export async function getAllTabs() {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const results = [];
    const req = tx.objectStore(STORE).index('archivedAt').openCursor(null, 'prev');
    req.onsuccess = ({ target: { result: cursor } }) => {
      if (cursor) { results.push(cursor.value); cursor.continue(); }
      else resolve(results);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function searchTabs(query, domain = null) {
  let tabs = await getAllTabs();
  if (domain) tabs = tabs.filter(t => t.domain === domain);
  if (!query?.trim()) return tabs;
  const q = query.toLowerCase().trim();
  return tabs.filter(t =>
    t.title?.toLowerCase().includes(q) ||
    t.url?.toLowerCase().includes(q) ||
    t.domain?.toLowerCase().includes(q)
  );
}

export async function deleteTab(id) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  return wrap(tx.objectStore(STORE).delete(id));
}

export async function deleteTabs(ids) {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  await Promise.all(ids.map(id => wrap(store.delete(id))));
}

export async function deleteAllTabs() {
  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  return wrap(tx.objectStore(STORE).clear());
}

export async function getCount() {
  const db = await open();
  const tx = db.transaction(STORE, 'readonly');
  return wrap(tx.objectStore(STORE).count());
}

export async function getDomains() {
  const tabs = await getAllTabs();
  const map = {};
  for (const tab of tabs) {
    map[tab.domain] = (map[tab.domain] || 0) + 1;
  }
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([domain, count]) => ({ domain, count }));
}

export async function pruneIfNeeded() {
  const all = await getAllTabs();
  const estimatedBytes = JSON.stringify(all).length * 2;
  if (estimatedBytes <= MAX_BYTES) return;

  const db = await open();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const sorted = [...all].sort((a, b) => a.archivedAt - b.archivedAt);
  let remaining = estimatedBytes;

  for (const tab of sorted) {
    if (remaining <= MAX_BYTES * 0.7) break;
    remaining -= JSON.stringify(tab).length * 2;
    store.delete(tab.id);
  }
}
