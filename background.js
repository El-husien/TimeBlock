const DEFAULT_BLOCKED_SITES = [
  "youtube.com",
  "reddit.com",
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "netflix.com"
];

const STORAGE_KEYS = {
  trackingData: "trackingData",
  blockedSites: "blockedSites",
  focusState: "focusState",
  userSettings: "userSettings",
  pomodoroState: "pomodoroState",
  scheduledBlocks: "scheduledBlocks",
  siteLimits: "siteLimits",
  limitBypass: "limitBypass"
};

const ALARMS = {
  focusEnd: "focusEnd",
  pomodoroTick: "pomodoroTick",
  trackingTick: "trackingTick"
};

const NOTIFICATION_ICON = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAABvUlEQVR4nO2a0Q3DIAxFf0jYf8m2dA6W0Dm0Dk2jQ5TIZmJfBfM9yR0M4wQ0Jt3a2f8xwAAAAAAAAAA8K8Wl7h2vS9f1f7l3G8Lx7P2lVx9q6zQm2k5j0iVx2e8lL5gX5e8q7m5D2k6xj4c5eV8Jm5Wj8S3p7g9c8Y5V2m+1l8f0l2KXwF+QjJH4A8n0K6z9xV6y8zRk0o7h0Hq9r2kR4rF9a4n8m7r0Aq1Hk7N1g7m8lqk7J2N8Q0u4m0u6y8S1f6I1YtJxY4E4J7Hc0hJ2Qv2KfQk3Lr0GzV8k0m0k0i0k2m0m4m8wq7j9f6o5S5j0u0x2v5h6d4x6Q7z4X7b9m8h8xkqQ9mVhNQW4gA2m5m1h8P0m9XhB8s2M0Zk9t6bH6m7fQ1s0dQzXH8Y0mQd6h5B0E6i2vJf8J5Qm0z4iU+2Xw3m4rYxv8r7H9q6xQ9Gv2mQW2zV8j6Aq2q0oGfR5l7nFJ2mX3m9n2w4x8Yd0J2k8w0AAAAAAAAAAAD8rQf7R6W0e8W5VQAAAABJRU5ErkJggg==";

const CATEGORY_MAP = {
  Work: ["gmail.com", "slack.com", "github.com", "jira.com", "notion.so", "asana.com", "trello.com", "figma.com", "stackoverflow.com", "linear.app"],
  Education: ["coursera.org", "udemy.com", "edx.org", "skillshare.com", "codecademy.com", "leetcode.com", "khanacademy.org", "docs.google.com"],
  Entertainment: ["youtube.com", "netflix.com", "twitch.tv", "hulu.com", "spotify.com", "disneyplus.com"],
  Social: ["facebook.com", "instagram.com", "twitter.com", "x.com", "tiktok.com", "reddit.com", "pinterest.com", "snapchat.com"],
  Shopping: ["amazon.com", "ebay.com", "aliexpress.com", "etsy.com"]
};

let state = {
  currentTab: null,
  startTime: null,
  isWindowFocused: true,
  isUserIdle: false,
  trackingData: {},
  blockedSites: [...DEFAULT_BLOCKED_SITES],
  focusState: {
    active: false,
    endTime: null,
    startTime: null,
    duration: 0,
    blockedSites: []
  },
  userSettings: {
    theme: "light",
    focusDuration: 25,
    enableNotif: true,
    soundNotif: false,
    pomodoro: {
      work: 25,
      shortBreak: 5,
      longBreak: 15,
      longBreakEvery: 4,
      autoStartBreaks: true,
      autoStartWork: false
    }
  },
  pomodoroState: {
    running: false,
    phase: "work",
    phaseStart: null,
    phaseEnd: null,
    cycle: 1,
    completedWorkSessions: 0,
    paused: false,
    remainingSeconds: null
  },
  scheduledBlocks: [],
  siteLimits: {},
  limitBypass: {}
};

const tabSafeUrlById = {};
const recentTabIds = [];

function rememberRecentTabId(tabId) {
  if (!tabId) return;
  const without = recentTabIds.filter((id) => id !== tabId);
  without.push(tabId);
  while (without.length > 12) {
    without.shift();
  }
  recentTabIds.length = 0;
  recentTabIds.push(...without);
}

async function getFallbackTabId(currentTabId) {
  const reversed = [...recentTabIds].reverse();
  for (const candidateId of reversed) {
    if (candidateId === currentTabId) continue;
    const tab = await chrome.tabs.get(candidateId).catch(() => null);
    if (!tab) continue;
    if (typeof tab.url === "string" && tab.url.startsWith("chrome-extension://") && tab.url.includes("blocked.html")) {
      continue;
    }
    return candidateId;
  }
  return null;
}

function todayKey() {
  return new Date().toISOString().split("T")[0];
}

function now() {
  return Date.now();
}

async function loadState() {
  const stored = await chrome.storage.local.get(Object.values(STORAGE_KEYS));
  state.trackingData = stored.trackingData || {};
  state.blockedSites = stored.blockedSites || [...DEFAULT_BLOCKED_SITES];
  state.focusState = { ...state.focusState, ...(stored.focusState || {}) };
  state.userSettings = {
    ...state.userSettings,
    ...(stored.userSettings || {}),
    pomodoro: {
      ...state.userSettings.pomodoro,
      ...((stored.userSettings || {}).pomodoro || {})
    }
  };
  state.pomodoroState = { ...state.pomodoroState, ...(stored.pomodoroState || {}) };
  state.scheduledBlocks = stored.scheduledBlocks || [];
  state.siteLimits = stored.siteLimits || {};
  state.limitBypass = stored.limitBypass || {};
}

async function persist(partial) {
  await chrome.storage.local.set(partial);
}

function canTrackUrl(url) {
  return typeof url === "string" && (url.startsWith("http://") || url.startsWith("https://"));
}

function urlDomain(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch (_error) {
    return "";
  }
}

function rememberSafeUrl(tab) {
  if (!tab || !tab.id || !canTrackUrl(tab.url)) {
    return;
  }
  const domain = urlDomain(tab.url);
  if (!domain) {
    return;
  }
  if (domainBlocked(domain) || isDomainLimitExceeded(domain)) {
    return;
  }
  tabSafeUrlById[tab.id] = tab.url;
}

function bypassKey(tabId, domain) {
  return `${tabId}:${domain}`;
}

function isTemporarilyAllowed(tabId, domain) {
  if (!tabId || !domain) {
    return false;
  }
  const entry = state.limitBypass[bypassKey(tabId, domain)];
  if (!entry) {
    return false;
  }
  if (entry.until <= now()) {
    delete state.limitBypass[bypassKey(tabId, domain)];
    return false;
  }
  return true;
}

async function grantTemporaryAllow(tabId, domain, seconds = 15) {
  if (!tabId || !domain) {
    return;
  }
  state.limitBypass[bypassKey(tabId, domain)] = {
    until: now() + Math.max(1, seconds) * 1000
  };
  await persist({ limitBypass: state.limitBypass });
}

function parseTab(tab) {
  if (!tab || !canTrackUrl(tab.url)) {
    return null;
  }
  const u = new URL(tab.url);
  return {
    id: tab.id,
    domain: u.hostname.replace(/^www\./, ""),
    path: u.pathname || "/",
    title: tab.title || "Unknown Tab"
  };
}

function categorizeWebsite(domain) {
  for (const [category, domains] of Object.entries(CATEGORY_MAP)) {
    if (domains.some((d) => domain.includes(d))) {
      return category;
    }
  }
  return "Other";
}

function domainBlocked(domain) {
  const activeList = state.focusState.active ? state.focusState.blockedSites : state.blockedSites;
  return activeList.some((blocked) => domain.includes(blocked));
}

function getDomainTrackedSecondsToday(domain) {
  const today = state.trackingData[todayKey()] || {};
  let total = 0;
  for (const site of Object.values(today)) {
    if (site.domain === domain) {
      total += site.total_time || 0;
    }
  }
  return total;
}

function getSiteLimitEntry(domain) {
  const raw = state.siteLimits[domain];
  if (raw === undefined || raw === null) {
    return null;
  }
  if (typeof raw === "number") {
    return {
      minutes: raw,
      startUsedSeconds: 0,
      createdAt: null
    };
  }
  return {
    minutes: Number(raw.minutes || 0),
    startUsedSeconds: Number(raw.startUsedSeconds || 0),
    createdAt: raw.createdAt || null
  };
}

function getDomainLimitStartUsedSeconds(domain) {
  const entry = getSiteLimitEntry(domain);
  if (!entry) {
    return 0;
  }
  return Math.max(0, Number(entry.startUsedSeconds || 0));
}

function getDomainLimitSeconds(domain) {
  const entry = getSiteLimitEntry(domain);
  const minutes = Number(entry?.minutes || 0);
  if (!minutes || minutes <= 0) {
    return 0;
  }
  return Math.floor(minutes * 60);
}

function isDomainLimitExceeded(domain) {
  const limit = getDomainLimitSeconds(domain);
  if (!limit) {
    return false;
  }
  const usedSinceLimitSet = Math.max(0, getDomainLiveSecondsToday(domain) - getDomainLimitStartUsedSeconds(domain));
  return usedSinceLimitSet >= limit;
}

function getDomainLiveSecondsToday(domain) {
  let total = getDomainTrackedSecondsToday(domain);
  const isLiveTab = state.currentTab && state.currentTab.domain === domain;
  const canCountLive = Boolean(isLiveTab && state.startTime && !state.isUserIdle);
  if (canCountLive) {
    total += Math.max(0, Math.floor((now() - state.startTime) / 1000));
  }
  return total;
}

function shouldNotify() {
  return state.userSettings.enableNotif !== false;
}

async function notify(title, message) {
  if (!shouldNotify()) {
    return;
  }
  await chrome.notifications.create({
    type: "basic",
    iconUrl: NOTIFICATION_ICON,
    title,
    message
  });
}

function setLimitBadge(tabDomain) {
  chrome.action.setBadgeText({ text: "LIMIT", tabId: undefined }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color: "#c83a3a" }).catch(() => {});
  setTimeout(() => {
    chrome.action.setBadgeText({ text: "", tabId: undefined }).catch(() => {});
  }, 5000);
}

async function saveCurrentTabDuration() {
  if (!state.currentTab || !state.startTime || state.isUserIdle) {
    return;
  }

  const duration = Math.floor((now() - state.startTime) / 1000);
  if (duration < 1) {
    return;
  }

  const day = todayKey();
  if (!state.trackingData[day]) {
    state.trackingData[day] = {};
  }

  const pageKey = `${state.currentTab.domain}${state.currentTab.path}`;
  if (!state.trackingData[day][pageKey]) {
    state.trackingData[day][pageKey] = {
      domain: state.currentTab.domain,
      path: state.currentTab.path,
      title: state.currentTab.title,
      total_time: 0,
      sessions: [],
      category: categorizeWebsite(state.currentTab.domain)
    };
  }

  state.trackingData[day][pageKey].total_time += duration;
  state.trackingData[day][pageKey].title = state.currentTab.title;
  state.trackingData[day][pageKey].sessions.push({
    start: new Date(state.startTime).toISOString(),
    duration
  });

  state.startTime = now();
  await persist({ trackingData: state.trackingData });
}

async function maybeBlockTab(tab) {
  const parsed = parseTab(tab);
  if (!parsed || !state.focusState.active) {
    return false;
  }

  if (domainBlocked(parsed.domain)) {
    const fallbackTabId = await getFallbackTabId(tab.id);
    const blockedUrl = chrome.runtime.getURL("blocked.html") + `?domain=${encodeURIComponent(parsed.domain)}&reason=focus&fallbackTabId=${encodeURIComponent(String(fallbackTabId || ""))}`;
    await chrome.tabs.update(tab.id, { url: blockedUrl });
    return true;
  }

  return false;
}

async function maybeBlockByLimit(tab) {
  const parsed = parseTab(tab);
  if (!parsed || isTemporarilyAllowed(tab.id, parsed.domain) || !isDomainLimitExceeded(parsed.domain)) {
    return false;
  }

  const fallbackTabId = await getFallbackTabId(tab.id);
  const sourceUrl = tab.url || "";
  const blockedUrl = chrome.runtime.getURL("blocked.html") + `?domain=${encodeURIComponent(parsed.domain)}&reason=limit&fallbackTabId=${encodeURIComponent(String(fallbackTabId || ""))}&sourceUrl=${encodeURIComponent(sourceUrl)}`;
  await chrome.tabs.update(tab.id, { url: blockedUrl });
  setLimitBadge(parsed.domain);
  await notify("Limit exceeded", `${parsed.domain} reached daily limit. Solve challenge to continue.`);
  return true;
}

async function recoverFromBlockedPage(tabId, reason, domain, fallbackTabId, sourceUrl, unlockApproved) {
  if (!tabId) {
    return { success: false, error: "Missing tab id" };
  }

  if (reason === "limit" && !unlockApproved) {
    return { success: false, error: "Challenge required", requireChallenge: true };
  }

  if (reason === "limit" && canTrackUrl(sourceUrl)) {
    const sourceDomain = urlDomain(sourceUrl);
    if (sourceDomain) {
      await grantTemporaryAllow(tabId, sourceDomain, 8 * 60 * 60);
      await chrome.tabs.update(tabId, { url: sourceUrl }).catch(() => {});
      return { success: true, mode: "source-url" };
    }
  }

  const fallbackId = Number(fallbackTabId || 0);
  if (fallbackId) {
    const fallbackTab = await chrome.tabs.get(fallbackId).catch(() => null);
    if (fallbackTab && fallbackTab.id !== tabId) {
      await chrome.tabs.update(fallbackTab.id, { active: true }).catch(() => {});
      await chrome.tabs.remove(tabId).catch(() => {});
      return { success: true, mode: "fallback-tab" };
    }
  }

  const safeUrl = tabSafeUrlById[tabId];
  if (safeUrl && canTrackUrl(safeUrl)) {
    const safeDomain = urlDomain(safeUrl);
    const blockedByFocus = state.focusState.active && domainBlocked(safeDomain);
    const blockedByLimit = isDomainLimitExceeded(safeDomain);
    const sameDomain = domain && safeDomain === domain;
    if (!blockedByFocus && !blockedByLimit && !sameDomain) {
      await chrome.tabs.update(tabId, { url: safeUrl }).catch(() => {});
      return { success: true, mode: "safe-url" };
    }
  }

  try {
    if (reason !== "limit") {
      await chrome.tabs.goBack(tabId);
      return { success: true, mode: "history" };
    }
  } catch (_error) {
    // fallback path below
  }

  const blockedTab = await chrome.tabs.get(tabId).catch(() => null);
  if (!blockedTab) {
    return { success: false, error: "Blocked tab not found" };
  }

  if (blockedTab.openerTabId) {
    await chrome.tabs.update(blockedTab.openerTabId, { active: true }).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
    return { success: true, mode: "opener" };
  }

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const candidate = tabs.find((t) => t.id !== tabId);
  if (candidate && candidate.id) {
    await chrome.tabs.update(candidate.id, { active: true }).catch(() => {});
    await chrome.tabs.remove(tabId).catch(() => {});
    return { success: true, mode: "neighbor" };
  }

  await chrome.tabs.update(tabId, { url: "chrome://newtab" }).catch(() => {});
  return { success: true, mode: "newtab" };
}

function focusRemainingMs() {
  if (!state.focusState.active || !state.focusState.endTime) {
    return 0;
  }
  return Math.max(0, state.focusState.endTime - now());
}

async function stopFocusMode(reason = "manual") {
  state.focusState = {
    active: false,
    endTime: null,
    startTime: null,
    duration: 0,
    blockedSites: []
  };
  await chrome.alarms.clear(ALARMS.focusEnd);
  await persist({ focusState: state.focusState });
  if (reason === "expired") {
    await notify("Focus finished", "Great work. Your focus session is complete.");
  }
  await chrome.runtime.sendMessage({ action: "focusModeChanged", reason }).catch(() => {});
}

async function startFocusMode(data = {}) {
  const duration = Math.max(1, Number(data.duration || state.userSettings.focusDuration || 25));
  const blockedSites = Array.isArray(data.blockedSites) && data.blockedSites.length > 0
    ? data.blockedSites
    : state.blockedSites;

  const startTime = now();
  const endTime = startTime + duration * 60 * 1000;

  state.focusState = {
    active: true,
    startTime,
    endTime,
    duration,
    blockedSites
  };

  await persist({ focusState: state.focusState, blockedSites: state.blockedSites });
  await chrome.alarms.create(ALARMS.focusEnd, { when: endTime });
  await notify("Focus started", `${duration} minutes started. Distractions are blocked.`);
  await chrome.runtime.sendMessage({ action: "focusModeChanged", reason: "start" }).catch(() => {});

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    await maybeBlockTab(activeTab);
  }
}

function getPomodoroDurationMinutes(phase) {
  const cfg = state.userSettings.pomodoro;
  if (phase === "work") return cfg.work;
  if (phase === "shortBreak") return cfg.shortBreak;
  return cfg.longBreak;
}

function nextPomodoroPhase() {
  const cfg = state.userSettings.pomodoro;
  if (state.pomodoroState.phase === "work") {
    const workCount = state.pomodoroState.completedWorkSessions + 1;
    const isLongBreak = workCount % Math.max(1, cfg.longBreakEvery) === 0;
    return isLongBreak ? "longBreak" : "shortBreak";
  }
  return "work";
}

async function schedulePomodoroTick() {
  if (!state.pomodoroState.running || state.pomodoroState.paused || !state.pomodoroState.phaseEnd) {
    await chrome.alarms.clear(ALARMS.pomodoroTick);
    return;
  }
  await chrome.alarms.create(ALARMS.pomodoroTick, { when: state.pomodoroState.phaseEnd });
}

async function persistPomodoro() {
  await persist({ pomodoroState: state.pomodoroState });
  await chrome.runtime.sendMessage({ action: "pomodoroUpdated", data: state.pomodoroState }).catch(() => {});
}

async function startPomodoro(payload = {}) {
  if (payload.reset === true) {
    state.pomodoroState.completedWorkSessions = 0;
    state.pomodoroState.cycle = 1;
  }

  const phase = payload.phase || state.pomodoroState.phase || "work";
  const durationMinutes = getPomodoroDurationMinutes(phase);
  const phaseStart = now();
  const phaseEnd = phaseStart + durationMinutes * 60 * 1000;

  state.pomodoroState = {
    ...state.pomodoroState,
    running: true,
    paused: false,
    phase,
    phaseStart,
    phaseEnd,
    remainingSeconds: null
  };

  if (phase === "work") {
    await startFocusMode({ duration: durationMinutes, blockedSites: state.blockedSites });
  } else {
    await stopFocusMode("break-start");
  }

  await schedulePomodoroTick();
  await persistPomodoro();
}

async function pausePomodoro() {
  if (!state.pomodoroState.running || state.pomodoroState.paused || !state.pomodoroState.phaseEnd) {
    return;
  }
  state.pomodoroState.remainingSeconds = Math.max(0, Math.floor((state.pomodoroState.phaseEnd - now()) / 1000));
  state.pomodoroState.paused = true;
  state.pomodoroState.phaseEnd = null;
  await chrome.alarms.clear(ALARMS.pomodoroTick);
  await persistPomodoro();
  await stopFocusMode("pomodoro-paused");
}

async function resumePomodoro() {
  if (!state.pomodoroState.running || !state.pomodoroState.paused) {
    return;
  }
  const remain = Math.max(1, Number(state.pomodoroState.remainingSeconds || 0));
  state.pomodoroState.paused = false;
  state.pomodoroState.phaseStart = now();
  state.pomodoroState.phaseEnd = now() + remain * 1000;
  state.pomodoroState.remainingSeconds = null;

  if (state.pomodoroState.phase === "work") {
    await startFocusMode({ duration: Math.ceil(remain / 60), blockedSites: state.blockedSites });
  }

  await schedulePomodoroTick();
  await persistPomodoro();
}

async function stopPomodoro() {
  state.pomodoroState = {
    running: false,
    phase: "work",
    phaseStart: null,
    phaseEnd: null,
    cycle: 1,
    completedWorkSessions: 0,
    paused: false,
    remainingSeconds: null
  };
  await chrome.alarms.clear(ALARMS.pomodoroTick);
  await persistPomodoro();
  await stopFocusMode("pomodoro-stopped");
}

async function advancePomodoroPhase() {
  if (!state.pomodoroState.running) {
    return;
  }

  const previous = state.pomodoroState.phase;
  if (previous === "work") {
    state.pomodoroState.completedWorkSessions += 1;
    state.pomodoroState.cycle = state.pomodoroState.completedWorkSessions + 1;
  }

  const nextPhase = nextPomodoroPhase();
  const labels = {
    work: "Work sprint",
    shortBreak: "Short break",
    longBreak: "Long break"
  };
  const cfg = state.userSettings.pomodoro;
  const autoStart = nextPhase === "work" ? cfg.autoStartWork : cfg.autoStartBreaks;

  state.pomodoroState.phase = nextPhase;

  if (!autoStart) {
    state.pomodoroState.paused = true;
    state.pomodoroState.running = true;
    state.pomodoroState.phaseStart = null;
    state.pomodoroState.phaseEnd = null;
    state.pomodoroState.remainingSeconds = getPomodoroDurationMinutes(nextPhase) * 60;
    await persistPomodoro();
    await stopFocusMode("phase-switch");
    await notify("Pomodoro phase ready", `${labels[nextPhase]} is ready to start.`);
    return;
  }

  await notify("Pomodoro switched", `${labels[nextPhase]} started.`);
  await startPomodoro({ phase: nextPhase });
}

async function setCurrentTrackingTab(tabId) {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  const parsed = parseTab(tab);
  if (!parsed) {
    state.currentTab = null;
    state.startTime = null;
    return;
  }

  if (state.focusState.active && domainBlocked(parsed.domain)) {
    await maybeBlockTab(tab);
    state.currentTab = null;
    state.startTime = null;
    return;
  }

  if (isDomainLimitExceeded(parsed.domain)) {
    await maybeBlockByLimit(tab);
    state.currentTab = null;
    state.startTime = null;
    return;
  }

  state.currentTab = parsed;
  state.startTime = now();
}

async function initialize() {
  await loadState();

  if (state.focusState.active && focusRemainingMs() <= 0) {
    await stopFocusMode("expired-on-start");
  } else if (state.focusState.active && state.focusState.endTime) {
    await chrome.alarms.create(ALARMS.focusEnd, { when: state.focusState.endTime });
  }

  if (state.pomodoroState.running && !state.pomodoroState.paused) {
    if (!state.pomodoroState.phaseEnd || state.pomodoroState.phaseEnd <= now()) {
      await advancePomodoroPhase();
    } else {
      await schedulePomodoroTick();
    }
  }

  await chrome.alarms.create(ALARMS.trackingTick, { periodInMinutes: 1 });

  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (activeTab) {
    await setCurrentTrackingTab(activeTab.id);
  }
}

chrome.runtime.onInstalled.addListener(async () => {
  await initialize();
  await chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html?tab=overview") });
});

chrome.runtime.onStartup.addListener(async () => {
  await initialize();
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  rememberRecentTabId(tabId);
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  rememberSafeUrl(tab);
  await saveCurrentTabDuration();
  await setCurrentTrackingTab(tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete") {
    rememberSafeUrl(tab);
  }

  if (changeInfo.status === "loading" && tab.active) {
    await saveCurrentTabDuration();
    await setCurrentTrackingTab(tabId);
  }

  if (canTrackUrl(changeInfo.url || tab.url) && state.focusState.active) {
    await maybeBlockTab(tab);
  }

  if (canTrackUrl(changeInfo.url || tab.url)) {
    await maybeBlockByLimit(tab);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const keys = Object.keys(state.limitBypass || {}).filter((key) => key.startsWith(`${tabId}:`));
  if (keys.length > 0) {
    keys.forEach((key) => delete state.limitBypass[key]);
    await persist({ limitBypass: state.limitBypass });
  }

  const index = recentTabIds.indexOf(tabId);
  if (index >= 0) {
    recentTabIds.splice(index, 1);
  }

  if (state.currentTab && state.currentTab.id === tabId) {
    await saveCurrentTabDuration();
    state.currentTab = null;
    state.startTime = null;
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    state.isWindowFocused = false;
    return;
  }

  state.isWindowFocused = true;
  if (!state.startTime && state.currentTab && !state.isUserIdle) {
    state.startTime = now();
  } else {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
      await setCurrentTrackingTab(activeTab.id);
    }
  }

  if (!state.currentTab) {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (activeTab) {
    await setCurrentTrackingTab(activeTab.id);
    }
  }
});

chrome.idle.onStateChanged.addListener(async (idleState) => {
  const nowIdle = idleState !== "active";
  if (nowIdle === state.isUserIdle) {
    return;
  }
  state.isUserIdle = nowIdle;

  if (nowIdle) {
    await saveCurrentTabDuration();
    state.startTime = null;
  } else if (state.currentTab) {
    state.startTime = now();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARMS.focusEnd) {
    await stopFocusMode("expired");
    return;
  }

  if (alarm.name === ALARMS.pomodoroTick) {
    await advancePomodoroPhase();
    return;
  }

  if (alarm.name === ALARMS.trackingTick) {
    await saveCurrentTabDuration();
    if (state.currentTab) {
      const tab = await chrome.tabs.get(state.currentTab.id).catch(() => null);
      if (tab) {
        await maybeBlockByLimit(tab);
      }
    }
  }
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    if (request.action === "startFocusMode") {
      await startFocusMode(request.data || {});
      sendResponse({ success: true });
      return;
    }

    if (request.action === "stopFocusMode") {
      await stopFocusMode("manual");
      sendResponse({ success: true });
      return;
    }

    if (request.action === "updateBlockedSites") {
      state.blockedSites = Array.isArray(request.data) ? request.data : state.blockedSites;
      await persist({ blockedSites: state.blockedSites });
      sendResponse({ success: true, blockedSites: state.blockedSites });
      return;
    }

    if (request.action === "saveUserSettings") {
      state.userSettings = {
        ...state.userSettings,
        ...(request.data || {}),
        pomodoro: {
          ...state.userSettings.pomodoro,
          ...((request.data || {}).pomodoro || {})
        }
      };
      await persist({ userSettings: state.userSettings });
      sendResponse({ success: true, userSettings: state.userSettings });
      return;
    }

    if (request.action === "saveScheduledBlocks") {
      state.scheduledBlocks = Array.isArray(request.data) ? request.data : [];
      await persist({ scheduledBlocks: state.scheduledBlocks });
      sendResponse({ success: true });
      return;
    }

    if (request.action === "setSiteLimit") {
      const domain = String(request.data?.domain || "").toLowerCase().trim();
      const minutes = Number(request.data?.minutes || 0);
      const resetFromNow = request.data?.resetFromNow === true;
      if (!domain || minutes <= 0) {
        sendResponse({ success: false, error: "Invalid domain or minutes" });
        return;
      }
      const existing = getSiteLimitEntry(domain);
      const startUsedSeconds = (resetFromNow || !existing)
        ? getDomainLiveSecondsToday(domain)
        : Number(existing?.startUsedSeconds || 0);
      state.siteLimits[domain] = {
        minutes,
        startUsedSeconds,
        createdAt: now()
      };
      await persist({ siteLimits: state.siteLimits });
      sendResponse({ success: true, siteLimits: state.siteLimits });
      return;
    }

    if (request.action === "removeSiteLimit") {
      const domain = String(request.data?.domain || "").toLowerCase().trim();
      if (domain && state.siteLimits[domain]) {
        delete state.siteLimits[domain];
        await persist({ siteLimits: state.siteLimits });
      }
      sendResponse({ success: true, siteLimits: state.siteLimits });
      return;
    }

    if (request.action === "getTracking") {
      sendResponse({ data: state.trackingData[todayKey()] || {} });
      return;
    }

    if (request.action === "getDomainLiveUsage") {
      const domain = String(request.data?.domain || "").toLowerCase().trim();
      if (!domain) {
        sendResponse({ success: false, error: "Missing domain" });
        return;
      }
      const usedSeconds = getDomainLiveSecondsToday(domain);
      const limitSeconds = getDomainLimitSeconds(domain);
      const startUsedSeconds = getDomainLimitStartUsedSeconds(domain);
      const usedSinceLimitSet = limitSeconds
        ? Math.max(0, usedSeconds - startUsedSeconds)
        : usedSeconds;
      const remainingSeconds = limitSeconds ? Math.max(0, limitSeconds - usedSinceLimitSet) : null;
      const isRunning = Boolean(
        state.currentTab &&
        state.currentTab.domain === domain &&
        state.startTime &&
        !state.isUserIdle
      );

      if (limitSeconds && remainingSeconds === 0 && state.currentTab && state.currentTab.domain === domain) {
        const liveTab = await chrome.tabs.get(state.currentTab.id).catch(() => null);
        if (liveTab) {
          await maybeBlockByLimit(liveTab);
        }
      }

      sendResponse({
        success: true,
        domain,
        usedSeconds: usedSinceLimitSet,
        totalUsedSeconds: usedSeconds,
        startUsedSeconds,
        limitSeconds,
        remainingSeconds,
        isRunning
      });
      return;
    }

    if (request.action === "getStats") {
      sendResponse({
        data: state.trackingData,
        blockedSites: state.blockedSites,
        focusMode: state.focusState.active,
        focusState: {
          ...state.focusState,
          remainingMs: focusRemainingMs()
        },
        userSettings: state.userSettings,
        pomodoroState: state.pomodoroState,
        scheduledBlocks: state.scheduledBlocks,
        siteLimits: state.siteLimits
      });
      return;
    }

    if (request.action === "pomodoroStart") {
      await startPomodoro(request.data || {});
      sendResponse({ success: true, pomodoroState: state.pomodoroState });
      return;
    }

    if (request.action === "pomodoroPause") {
      await pausePomodoro();
      sendResponse({ success: true, pomodoroState: state.pomodoroState });
      return;
    }

    if (request.action === "pomodoroResume") {
      await resumePomodoro();
      sendResponse({ success: true, pomodoroState: state.pomodoroState });
      return;
    }

    if (request.action === "pomodoroSkip") {
      await advancePomodoroPhase();
      sendResponse({ success: true, pomodoroState: state.pomodoroState });
      return;
    }

    if (request.action === "pomodoroStop") {
      await stopPomodoro();
      sendResponse({ success: true, pomodoroState: state.pomodoroState });
      return;
    }

    if (request.action === "flushTracking") {
      await saveCurrentTabDuration();
      sendResponse({ success: true });
      return;
    }

    if (request.action === "recoverFromBlockedPage") {
      const tabId = sender?.tab?.id;
      const result = await recoverFromBlockedPage(
        tabId,
        String(request.data?.reason || ""),
        String(request.data?.domain || ""),
        String(request.data?.fallbackTabId || ""),
        String(request.data?.sourceUrl || ""),
        Boolean(request.data?.unlockApproved)
      );
      sendResponse(result);
      return;
    }

    sendResponse({ success: false, error: "Unknown action" });
  })().catch((error) => {
    sendResponse({ success: false, error: error.message });
  });

  return true;
});

initialize();
