let allTrackingData = {};
let blockedSitesList = [];
let userSettings = {};
let scheduledBlocks = [];
let siteLimits = {};
let weekCursor = getWeekStart(new Date());

function limitMinutesFromValue(value) {
  if (typeof value === "number") {
    return value;
  }
  if (value && typeof value === "object") {
    return Number(value.minutes || 0);
  }
  return 0;
}

document.addEventListener("DOMContentLoaded", async () => {
  setupNavigation();
  setupEventListeners();
  await loadDashboard();
  setInterval(loadDashboard, 30000);
});

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => resolve(response || {}));
  });
}

function setupNavigation() {
  const links = document.querySelectorAll(".nav-link");
  const tabs = document.querySelectorAll(".tab-content");

  links.forEach((link) => {
    link.addEventListener("click", () => {
      const tab = link.dataset.tab;
      links.forEach((n) => n.classList.remove("active"));
      tabs.forEach((t) => t.classList.remove("active"));
      link.classList.add("active");
      document.getElementById(tab).classList.add("active");
      document.getElementById("pageTitle").textContent = link.textContent;
    });
  });

  const paramTab = new URLSearchParams(window.location.search).get("tab");
  if (paramTab) {
    document.querySelector(`.nav-link[data-tab="${paramTab}"]`)?.click();
  }
}

async function loadDashboard() {
  await sendMessage({ action: "flushTracking" });
  const response = await sendMessage({ action: "getStats" });
  allTrackingData = response.data || {};
  blockedSitesList = response.blockedSites || [];
  userSettings = response.userSettings || {};
  scheduledBlocks = response.scheduledBlocks || [];
  siteLimits = response.siteLimits || {};

  updateOverview();
  renderBlockedSites();
  renderSiteLimits();
  renderWeekView();
  renderScheduledBlocks();
  hydrateSettingsForms();
  updateAnalyticsChart(document.getElementById("dateRange")?.value || "today");
  renderDomainOverallChart();
  await renderLiveTabs();
}

function updateOverview() {
  const today = new Date().toISOString().split("T")[0];
  const data = allTrackingData[today] || {};
  let total = 0;
  const cat = { Work: 0, Education: 0, Entertainment: 0, Social: 0, Other: 0 };
  const sites = [];

  for (const site of Object.values(data)) {
    total += site.total_time;
    cat[site.category] = (cat[site.category] || 0) + site.total_time;
    sites.push({
      domain: site.domain,
      path: site.path,
      category: site.category,
      time: site.total_time,
      sessions: (site.sessions || []).length
    });
  }

  const focus = (cat.Work || 0) + (cat.Education || 0);
  const productivity = total ? Math.round((focus / total) * 100) : 0;

  document.getElementById("summaryTotal").textContent = formatTime(total);
  document.getElementById("summaryFocus").textContent = formatTime(focus);
  document.getElementById("summaryProductivity").textContent = `${productivity}%`;

  renderBars("categoryChart", cat);
  renderWeekBars();
  renderTopSitesTable(sites.sort((a, b) => b.time - a.time));
}

function renderTopSitesTable(sites) {
  const tbody = document.getElementById("topSitesBody");
  tbody.innerHTML = "";
  if (!sites.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="empty">No data yet.</td></tr>';
    return;
  }
  sites.slice(0, 12).forEach((site) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${site.domain}</strong><br><small>${site.path}</small></td>
      <td>${formatSeconds(site.time)}</td>
      <td>${site.category}</td>
      <td>${site.sessions}</td>
    `;
    tbody.appendChild(tr);
  });
}

function renderBars(containerId, values) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  const entries = Object.entries(values).filter(([, v]) => v > 0);
  const total = entries.reduce((acc, [, v]) => acc + v, 0);

  if (!entries.length) {
    container.innerHTML = '<p class="empty">No chart data yet.</p>';
    return;
  }

  entries.forEach(([label, value]) => {
    const percent = Math.round((value / total) * 100);
    const row = document.createElement("article");
    row.className = "category-row";
    row.innerHTML = `
      <div class="category-top"><strong>${label}</strong><span>${formatSeconds(value)} · ${percent}%</span></div>
      <div class="category-bar"><span style="width:${percent}%"></span></div>
    `;
    container.appendChild(row);
  });
}

function renderWeekBars() {
  const values = {};
  for (let i = 6; i >= 0; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    const label = d.toLocaleDateString(undefined, { weekday: "short" });
    values[label] = Object.values(allTrackingData[key] || {}).reduce((sum, site) => sum + site.total_time, 0);
  }
  renderBars("weekChart", values);
}

function updateAnalyticsChart(range) {
  const points = {};

  if (range === "today") {
    const today = new Date().toISOString().split("T")[0];
    for (let h = 0; h < 24; h += 1) points[`${String(h).padStart(2, "0")}:00`] = 0;
    for (const site of Object.values(allTrackingData[today] || {})) {
      for (const sess of site.sessions || []) {
        const hour = new Date(sess.start).getHours();
        const key = `${String(hour).padStart(2, "0")}:00`;
        points[key] += sess.duration || 0;
      }
    }
  } else if (range === "week") {
    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const key = d.toISOString().split("T")[0];
      const label = d.toLocaleDateString(undefined, { weekday: "short" });
      points[label] = Object.values(allTrackingData[key] || {}).reduce((sum, site) => sum + site.total_time, 0);
    }
  } else if (range === "month") {
    for (let i = 3; i >= 0; i -= 1) {
      const weekSum = sumDays(i * 7 + 6, i * 7);
      points[`Week ${4 - i}`] = weekSum;
    }
  } else {
    const dates = Object.keys(allTrackingData).sort();
    dates.slice(-30).forEach((date) => {
      const label = new Date(date).toLocaleDateString(undefined, { month: "short", day: "numeric" });
      points[label] = Object.values(allTrackingData[date] || {}).reduce((sum, site) => sum + site.total_time, 0);
    });
  }

  renderBars("analyticsChart", points);
}

function renderDomainOverallChart() {
  const totals = {};
  for (const dayData of Object.values(allTrackingData)) {
    for (const site of Object.values(dayData || {})) {
      totals[site.domain] = (totals[site.domain] || 0) + (site.total_time || 0);
    }
  }

  const topEntries = Object.entries(totals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  renderBars("domainOverallChart", Object.fromEntries(topEntries));
}

async function renderLiveTabs() {
  const container = document.getElementById("liveTabsCards");
  if (!container) return;
  container.innerHTML = "";

  const tabs = await chrome.tabs.query({ currentWindow: true });
  const trackable = tabs.filter((tab) => typeof tab.url === "string" && (tab.url.startsWith("http://") || tab.url.startsWith("https://")));
  const today = new Date().toISOString().split("T")[0];
  const todayTotals = {};

  for (const site of Object.values(allTrackingData[today] || {})) {
    todayTotals[site.domain] = (todayTotals[site.domain] || 0) + (site.total_time || 0);
  }

  if (!trackable.length) {
    container.innerHTML = '<p class="empty">No trackable tabs in this window.</p>';
    return;
  }

  trackable.slice(0, 12).forEach((tab) => {
    const domain = new URL(tab.url).hostname.replace(/^www\./, "");
    const card = document.createElement("article");
    card.className = "tab-card";
    card.innerHTML = `
      <p class="tab-domain">${domain}</p>
      <h4>${tab.active ? "Active" : "Open"}</h4>
      <span>${formatSeconds(todayTotals[domain] || 0)} today</span>
      <button class="btn-secondary" data-open-live-tab="${tab.id}">Switch</button>
    `;
    container.appendChild(card);
  });

  container.querySelectorAll("button[data-open-live-tab]").forEach((button) => {
    button.addEventListener("click", async () => {
      const tabId = Number(button.getAttribute("data-open-live-tab"));
      await chrome.tabs.update(tabId, { active: true });
    });
  });
}

function sumDays(fromDaysAgo, toDaysAgo) {
  let total = 0;
  for (let i = fromDaysAgo; i >= toDaysAgo; i -= 1) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split("T")[0];
    total += Object.values(allTrackingData[key] || {}).reduce((sum, site) => sum + site.total_time, 0);
  }
  return total;
}

function renderWeekView() {
  const view = document.getElementById("weekView");
  view.innerHTML = "";

  const start = new Date(weekCursor);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  document.getElementById("weekDisplay").textContent = `${start.toLocaleDateString()} - ${end.toLocaleDateString()}`;

  for (let i = 0; i < 7; i += 1) {
    const day = new Date(start);
    day.setDate(day.getDate() + i);
    const dateKey = day.toISOString().split("T")[0];
    const seconds = Object.values(allTrackingData[dateKey] || {}).reduce((sum, site) => sum + site.total_time, 0);
    const card = document.createElement("article");
    card.className = "day-card";
    card.innerHTML = `
      <p>${day.toLocaleDateString(undefined, { weekday: "short" })}</p>
      <h4>${day.getDate()}</h4>
      <span>${formatSeconds(seconds)}</span>
    `;
    view.appendChild(card);
  }
}

function renderScheduledBlocks() {
  const container = document.getElementById("scheduledBlocksList");
  container.innerHTML = "";
  if (!scheduledBlocks.length) {
    container.innerHTML = '<p class="empty">No scheduled blocks yet.</p>';
    return;
  }

  scheduledBlocks
    .sort((a, b) => `${a.date}${a.start}`.localeCompare(`${b.date}${b.start}`))
    .forEach((block, index) => {
      const row = document.createElement("article");
      row.className = "site-row site-row-wide";
      row.innerHTML = `
        <div class="site-meta">
          <h4>${block.date}</h4>
          <p>${block.start} - ${block.end} ${block.blockDistract ? "· blocking" : ""}</p>
        </div>
        <button class="btn-danger" data-remove-block="${index}">Remove</button>
      `;
      container.appendChild(row);
    });
}

function renderBlockedSites() {
  const container = document.getElementById("blockedSitesList");
  container.innerHTML = "";
  if (!blockedSitesList.length) {
    container.innerHTML = '<p class="empty">No blocked sites yet.</p>';
    return;
  }

  blockedSitesList.forEach((site) => {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.innerHTML = `${site}<button data-remove-site="${site}">x</button>`;
    container.appendChild(chip);
  });
}

function renderSiteLimits() {
  const container = document.getElementById("siteLimitsList");
  if (!container) return;
  container.innerHTML = "";

  const today = new Date().toISOString().split("T")[0];
  const domains = new Set(Object.values(allTrackingData[today] || {}).map((site) => site.domain));
  Object.keys(siteLimits).forEach((d) => domains.add(d));

  if (!domains.size) {
    container.innerHTML = '<p class="empty">No site limits yet.</p>';
    return;
  }

  [...domains].sort().forEach((domain) => {
    const row = document.createElement("article");
    row.className = "site-row site-row-wide";
    row.innerHTML = `
      <div class="site-meta"><h4>${domain}</h4><p>Set max daily minutes for this site</p></div>
      <input data-limit-domain="${domain}" type="number" min="1" max="720" value="${limitMinutesFromValue(siteLimits[domain]) || ""}" style="width:84px;">
      <div class="inline-actions">
        <button class="btn-secondary" data-save-limit="${domain}">Save</button>
        <button class="btn-danger" data-remove-limit="${domain}">Remove</button>
      </div>
    `;
    container.appendChild(row);
  });
}

function hydrateSettingsForms() {
  document.getElementById("themeSelect").value = userSettings.theme || "light";
  document.getElementById("focusDuration").value = userSettings.focusDuration || 25;
  document.getElementById("enableNotif").checked = userSettings.enableNotif !== false;
  document.getElementById("soundNotif").checked = Boolean(userSettings.soundNotif);

  const p = userSettings.pomodoro || {};
  document.getElementById("pWork").value = p.work || 25;
  document.getElementById("pShort").value = p.shortBreak || 5;
  document.getElementById("pLong").value = p.longBreak || 15;
  document.getElementById("pEvery").value = p.longBreakEvery || 4;
  document.getElementById("pAutoBreaks").checked = p.autoStartBreaks !== false;
  document.getElementById("pAutoWork").checked = Boolean(p.autoStartWork);
}

function setupEventListeners() {
  document.getElementById("syncBtn").addEventListener("click", loadDashboard);
  document.getElementById("openPopupBtn").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
  });

  document.getElementById("dateRange").addEventListener("change", (e) => updateAnalyticsChart(e.target.value));

  document.getElementById("prevWeek").addEventListener("click", () => {
    weekCursor.setDate(weekCursor.getDate() - 7);
    renderWeekView();
  });
  document.getElementById("nextWeek").addEventListener("click", () => {
    weekCursor.setDate(weekCursor.getDate() + 7);
    renderWeekView();
  });

  document.getElementById("blockForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const newBlock = {
      date: document.getElementById("blockDate").value,
      start: document.getElementById("blockStart").value,
      end: document.getElementById("blockEnd").value,
      blockDistract: document.getElementById("blockDistract").checked
    };
    if (!newBlock.date || !newBlock.start || !newBlock.end) return;
    scheduledBlocks.push(newBlock);
    await sendMessage({ action: "saveScheduledBlocks", data: scheduledBlocks });
    renderScheduledBlocks();
    e.target.reset();
  });

  document.getElementById("scheduledBlocksList").addEventListener("click", async (e) => {
    const index = e.target.getAttribute("data-remove-block");
    if (index === null) return;
    scheduledBlocks.splice(Number(index), 1);
    await sendMessage({ action: "saveScheduledBlocks", data: scheduledBlocks });
    renderScheduledBlocks();
  });

  document.getElementById("blockSiteForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = document.getElementById("newBlockedSite");
    const site = sanitizeDomain(input.value);
    if (!site || blockedSitesList.includes(site)) return;
    blockedSitesList.push(site);
    await sendMessage({ action: "updateBlockedSites", data: blockedSitesList });
    input.value = "";
    renderBlockedSites();
  });

  document.getElementById("blockedSitesList").addEventListener("click", async (e) => {
    const site = e.target.getAttribute("data-remove-site");
    if (!site) return;
    blockedSitesList = blockedSitesList.filter((s) => s !== site);
    await sendMessage({ action: "updateBlockedSites", data: blockedSitesList });
    renderBlockedSites();
  });

  document.getElementById("siteLimitsList")?.addEventListener("click", async (e) => {
    const saveDomain = e.target.getAttribute("data-save-limit");
    if (saveDomain) {
      const input = document.querySelector(`input[data-limit-domain="${saveDomain}"]`);
      const minutes = Number(input?.value || 0);
      if (minutes > 0) {
        await sendMessage({ action: "setSiteLimit", data: { domain: saveDomain, minutes } });
        await loadDashboard();
      }
      return;
    }

    const removeDomain = e.target.getAttribute("data-remove-limit");
    if (removeDomain) {
      await sendMessage({ action: "removeSiteLimit", data: { domain: removeDomain } });
      await loadDashboard();
    }
  });

  document.querySelectorAll(".quick-block").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const sites = (btn.dataset.sites || "").split(",").map((s) => s.trim()).filter(Boolean);
      blockedSitesList = [...new Set([...blockedSitesList, ...sites])];
      await sendMessage({ action: "updateBlockedSites", data: blockedSitesList });
      renderBlockedSites();
    });
  });

  document.getElementById("settingsForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const updated = {
      theme: document.getElementById("themeSelect").value,
      focusDuration: Number(document.getElementById("focusDuration").value || 25),
      enableNotif: document.getElementById("enableNotif").checked,
      soundNotif: document.getElementById("soundNotif").checked
    };
    await sendMessage({ action: "saveUserSettings", data: updated });
    await loadDashboard();
  });

  document.getElementById("pomodoroForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const pomodoro = {
      work: Number(document.getElementById("pWork").value || 25),
      shortBreak: Number(document.getElementById("pShort").value || 5),
      longBreak: Number(document.getElementById("pLong").value || 15),
      longBreakEvery: Number(document.getElementById("pEvery").value || 4),
      autoStartBreaks: document.getElementById("pAutoBreaks").checked,
      autoStartWork: document.getElementById("pAutoWork").checked
    };
    await sendMessage({ action: "saveUserSettings", data: { pomodoro } });
    await loadDashboard();
  });

  document.getElementById("exportData").addEventListener("click", exportDataAsCSV);
  document.getElementById("clearData").addEventListener("click", async () => {
    if (!confirm("Clear all tracking data?")) return;
    await chrome.storage.local.set({ trackingData: {} });
    allTrackingData = {};
    updateOverview();
    updateAnalyticsChart(document.getElementById("dateRange")?.value || "today");
    renderWeekView();
  });

  document.querySelectorAll(".picker-field").forEach((field) => {
    field.addEventListener("click", (e) => {
      if (e.target.tagName.toLowerCase() === "input") return;
      const input = field.querySelector("input");
      if (!input) return;
      input.focus();
      if (typeof input.showPicker === "function") {
        input.showPicker();
      }
    });
  });
}

function exportDataAsCSV() {
  let csv = "Date,Domain,Path,TimeSeconds,Category,Sessions\n";
  Object.entries(allTrackingData).forEach(([date, dayData]) => {
    Object.values(dayData).forEach((site) => {
      csv += `${date},"${site.domain}","${site.path}",${site.total_time},${site.category},${(site.sessions || []).length}\n`;
    });
  });
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `timeblock-${new Date().toISOString().split("T")[0]}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function sanitizeDomain(value) {
  return (value || "").trim().replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].toLowerCase();
}

function getWeekStart(date) {
  const d = new Date(date);
  const diff = d.getDate() - d.getDay();
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatSeconds(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}
