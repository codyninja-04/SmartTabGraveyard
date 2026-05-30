import { addTab, pruneIfNeeded, getCount } from '../lib/db.js';

const ALARM_NAME = 'checkInactiveTabs';
const ESTIMATED_MB_PER_TAB = 80;

const DEFAULT_SETTINGS = {
  threshold: 3,
  autoArchive: true,
};

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...settings };
}

async function getLastActiveMap() {
  const { lastActive = {} } = await chrome.storage.local.get('lastActive');
  return lastActive;
}

async function setLastActive(url, timestamp) {
  const lastActive = await getLastActiveMap();
  lastActive[url] = timestamp;

  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  for (const key of Object.keys(lastActive)) {
    if (lastActive[key] < cutoff) delete lastActive[key];
  }

  await chrome.storage.local.set({ lastActive });
}

function extractDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function isSkippable(tab) {
  if (tab.pinned) return true;
  if (tab.audible) return true;
  if (tab.active) return true;
  if (!tab.url) return true;
  const skip = ['chrome://', 'chrome-extension://', 'about:', 'devtools://'];
  return skip.some(prefix => tab.url.startsWith(prefix));
}

async function archiveTab(tab) {
  const domain = extractDomain(tab.url);
  const favicon =
    tab.favIconUrl && !tab.favIconUrl.startsWith('chrome') ? tab.favIconUrl : null;

  await addTab({
    url: tab.url,
    title: tab.title || tab.url,
    favicon,
    domain,
    archivedAt: Date.now(),
    lastActiveAt: tab.lastAccessed || Date.now(),
  });

  await chrome.tabs.remove(tab.id);
}

async function checkAndArchiveTabs() {
  const settings = await getSettings();
  if (!settings.autoArchive) return 0;

  const thresholdMs = settings.threshold * 24 * 60 * 60 * 1000;
  const lastActiveMap = await getLastActiveMap();
  const now = Date.now();
  const allTabs = await chrome.tabs.query({});

  let archived = 0;

  for (const tab of allTabs) {
    if (isSkippable(tab)) continue;

    const lastActive = lastActiveMap[tab.url] || tab.lastAccessed || null;
    if (!lastActive) continue;
    if (now - lastActive <= thresholdMs) continue;

    try {
      await archiveTab(tab);
      archived++;
    } catch (err) {
      console.error('[Graveyard] Failed to archive tab:', tab.url, err);
    }
  }

  if (archived > 0) await pruneIfNeeded();
  return archived;
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  const { settings } = await chrome.storage.local.get('settings');
  if (!settings) {
    await chrome.storage.local.set({ settings: DEFAULT_SETTINGS, lastActive: {} });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 60 });
  }
});

// ── Alarm ──────────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener(({ name }) => {
  if (name === ALARM_NAME) checkAndArchiveTabs();
});

// ── Tab tracking ───────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.url && !tab.url.startsWith('chrome')) {
      await setLastActive(tab.url, Date.now());
    }
  } catch {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && !tab.url.startsWith('chrome')) {
    await setLastActive(tab.url, Date.now());
  }
});

// ── Message bus ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === 'ACTIVITY') {
    setLastActive(message.url, message.timestamp || Date.now())
      .then(() => sendResponse({ ok: true }))
      .catch(() => sendResponse({ ok: false }));
    return true;
  }

  if (message.type === 'ARCHIVE_NOW') {
    checkAndArchiveTabs()
      .then(count => sendResponse({ count }))
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === 'GET_STATS') {
    getCount()
      .then(count =>
        sendResponse({ count, estimatedMB: count * ESTIMATED_MB_PER_TAB })
      )
      .catch(err => sendResponse({ error: err.message }));
    return true;
  }
});
