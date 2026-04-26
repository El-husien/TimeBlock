let latestStats = null;
let activeTabDomain = "";

document.addEventListener("DOMContentLoaded", async () => {
  setupTabNavigation();
  setupEventListeners();
  await refreshAll();
  setInterval(tickRealtime, 1000);
  setInterval(refreshAll, 10000);
});

function setupTabNavigation() {
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById(`${tab}-tab`)?.classList.add("active");
    });
  });
}

async function refreshAll() {
  await sendMessage({ action: "flushTracking" });
  await Promise.all([loadTodayStats(), updateFocusStatus(), updatePomodoroUI(), hydrateCurrentTabLimit()]);
}

async function tickRealtime() {
  await Promise.all([updateFocusStatus(), updatePomodoroUI(), updateCurrentTabLimitLiveOnly()]);
}

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
  });
}

function limitMinutesFromValue(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object") {
    return Number(value.minutes || 0);
  }
  return 0;
}

function sanitizeDomain(value) {
  return (value || "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

function setupEventListeners() {
  document.getElementById("focusBtn15").addEventListener("click", () => startFocusMode(15));
  document.getElementById("focusBtn25").addEventListener("click", () => startFocusMode(25));
  document.getElementById("focusBtn60").addEventListener("click", () => startFocusMode(60));
  document.getElementById("stopFocusBtn").addEventListener("click", stopFocusMode);

  document.getElementById("saveTabLimit").addEventListener("click", saveCurrentTabLimit);
  document.getElementById("saveQuickPomodoro").addEventListener("click", saveQuickPomodoro);

  document.getElementById("pomodoroStart").addEventListener("click", () => handlePomodoroAction("pomodoroStart"));
  document.getElementById("pomodoroPause").addEventListener("click", () => handlePomodoroAction("pomodoroPause"));
  document.getElementById("pomodoroSkip").addEventListener("click", () => handlePomodoroAction("pomodoroSkip"));
  document.getElementById("pomodoroStop").addEventListener("click", () => handlePomodoroAction("pomodoroStop"));

  document.getElementById("viewFullStats").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
  });
}

async function handlePomodoroAction(action) {
  if (action === "pomodoroStart") {
    const stats = await sendMessage({ action: "getStats" });
    const paused = Boolean(stats.pomodoroState && stats.pomodoroState.paused);
    await sendMessage({ action: paused ? "pomodoroResume" : "pomodoroStart" });
  } else {
    await sendMessage({ action });
  }
  await refreshAll();
}

async function loadTodayStats() {
  const response = await sendMessage({ action: "getTracking" });
  const data = response.data || {};

  let totalSeconds = 0;
  const categoryTotals = {
    Work: 0,
    Education: 0,
    Entertainment: 0,
    Social: 0,
    Other: 0
  };

  const sitesList = Object.values(data).map((site) => {
    totalSeconds += site.total_time;
    categoryTotals[site.category] = (categoryTotals[site.category] || 0) + site.total_time;
    return {
      domain: site.domain,
      path: site.path,
      title: site.title,
      time: site.total_time,
      category: site.category
    };
  });

  sitesList.sort((a, b) => b.time - a.time);

  const focusTime = (categoryTotals.Work || 0) + (categoryTotals.Education || 0);
  const distractionTime = (categoryTotals.Entertainment || 0) + (categoryTotals.Social || 0);

  document.getElementById("totalTime").textContent = formatSeconds(totalSeconds);
  document.getElementById("focusTime").textContent = formatSeconds(focusTime);
  document.getElementById("distractionTime").textContent = formatSeconds(distractionTime);

  latestStats = { totalSeconds, focusTime, distractionTime, categoryTotals, sitesList };
}

async function startFocusMode(minutes) {
  const stats = await sendMessage({ action: "getStats" });
  const blockedSites = stats.blockedSites || [];
  await sendMessage({
    action: "startFocusMode",
    data: {
      duration: minutes,
      blockedSites
    }
  });
  await updateFocusStatus();
}

async function stopFocusMode() {
  await sendMessage({ action: "stopFocusMode" });
  await updateFocusStatus();
}

async function updateFocusStatus() {
  const response = await sendMessage({ action: "getStats" });
  const active = Boolean(response.focusMode);
  const remainingMs = (response.focusState && response.focusState.remainingMs) || 0;
  const text = active
    ? `Focus active · ${formatClock(Math.floor(remainingMs / 1000))} left`
    : "Focus mode off";

  const node = document.getElementById("focusStatus");
  node.textContent = text;
  node.classList.toggle("focus-active", active);
}

async function updatePomodoroUI() {
  const response = await sendMessage({ action: "getStats" });
  const p = response.pomodoroState || {};

  let remaining = 25 * 60;
  if (p.running && !p.paused && p.phaseEnd) {
    remaining = Math.max(0, Math.floor((p.phaseEnd - Date.now()) / 1000));
  } else if (typeof p.remainingSeconds === "number") {
    remaining = p.remainingSeconds;
  } else if (response.userSettings && response.userSettings.pomodoro) {
    remaining = (response.userSettings.pomodoro.work || 25) * 60;
  }

  const phaseLabels = {
    work: "Work sprint",
    shortBreak: "Short break",
    longBreak: "Long break"
  };

  document.getElementById("pomodoroTimer").textContent = formatClock(remaining);
  document.getElementById("pomodoroPhaseLabel").textContent = p.running
    ? `${phaseLabels[p.phase] || "Pomodoro"}${p.paused ? " (paused)" : ""}`
    : "Pomodoro ready";
  document.getElementById("pomodoroCycle").textContent = `Cycle ${p.cycle || 1}`;

  const cfg = (response.userSettings && response.userSettings.pomodoro) || {};
  document.getElementById("quickWorkMinutes").value = cfg.work || 25;
  document.getElementById("quickBreakMinutes").value = cfg.shortBreak || 5;
}

async function saveQuickPomodoro() {
  const work = Number(document.getElementById("quickWorkMinutes").value || 25);
  const shortBreak = Number(document.getElementById("quickBreakMinutes").value || 5);
  await sendMessage({
    action: "saveUserSettings",
    data: {
      pomodoro: {
        work: Math.max(10, Math.min(90, work)),
        shortBreak: Math.max(3, Math.min(30, shortBreak))
      }
    }
  });
  await refreshAll();
}

async function hydrateCurrentTabLimit() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || (!tab.url.startsWith("http://") && !tab.url.startsWith("https://"))) {
    activeTabDomain = "";
    document.getElementById("currentTabDomain").value = "Not a trackable tab";
    document.getElementById("currentTabUsed").textContent = "Used: 0s";
    document.getElementById("currentTabRemaining").textContent = "No limit set";
    document.getElementById("limitProgressFill").style.width = "0%";
    return;
  }

  activeTabDomain = new URL(tab.url).hostname.replace(/^www\./, "");
  document.getElementById("currentTabDomain").value = activeTabDomain;

  const stats = await sendMessage({ action: "getStats" });
  const currentLimit = limitMinutesFromValue((stats.siteLimits || {})[activeTabDomain]);
  document.getElementById("currentTabLimit").value = currentLimit || "";
  await updateCurrentTabLimitProgress(activeTabDomain, currentLimit);
}

async function updateCurrentTabLimitLiveOnly() {
  if (!activeTabDomain) return;
  const limitMinutes = Number(document.getElementById("currentTabLimit").value || 0);
  await updateCurrentTabLimitProgress(activeTabDomain, limitMinutes);
}

async function updateCurrentTabLimitProgress(domain, limitMinutes) {
  const usage = await sendMessage({ action: "getDomainLiveUsage", data: { domain } });
  if (!usage.success) {
    return;
  }
  const usedSeconds = Number(usage.usedSeconds || 0);

  const usedNode = document.getElementById("currentTabUsed");
  const remainingNode = document.getElementById("currentTabRemaining");
  const bar = document.getElementById("limitProgressFill");

  usedNode.textContent = `Used since set: ${formatSeconds(usedSeconds)}`;

  if (!limitMinutes) {
    bar.style.width = "0%";
    remainingNode.textContent = "No limit set";
    bar.classList.remove("over");
    return;
  }

  const totalSeconds = Math.max(60, Math.floor(limitMinutes * 60));
  const remaining = Math.max(0, totalSeconds - usedSeconds);
  const percent = Math.min(100, Math.round((usedSeconds / totalSeconds) * 100));

  bar.style.width = `${percent}%`;
  remainingNode.textContent = remaining > 0
    ? `Remaining: ${formatClock(remaining)}${usage.isRunning ? " (live)" : ""}`
    : "LIMIT REACHED";
  bar.classList.toggle("over", remaining === 0);
  bar.classList.toggle("warning", remaining > 0 && percent >= 75);
  
  if (remaining === 0) {
    document.getElementById("limitProgressFill").parentElement?.classList.add("limit-hit");
  } else if (percent >= 75) {
    remainingNode.textContent = `⚠️ ${remainingNode.textContent}`;
  }
}

async function saveCurrentTabLimit() {
  if (!activeTabDomain) return;
  const minutes = Number(document.getElementById("currentTabLimit").value || 0);
  if (minutes <= 0) return;
  await sendMessage({ action: "setSiteLimit", data: { domain: activeTabDomain, minutes } });
  await refreshAll();
}

async function removeCurrentTabLimit() {
  if (!activeTabDomain) return;
  await sendMessage({ action: "removeSiteLimit", data: { domain: activeTabDomain } });
  document.getElementById("currentTabLimit").value = "";
}

function formatSeconds(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatClock(seconds) {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
