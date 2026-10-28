const statuses = ["Investigating", "Identified", "Monitoring", "Resolved"];
let dashboard = null;
let showAllActivity = false;
let toastTimer;

document.getElementById("current-date").textContent = new Intl.DateTimeFormat("en", {
  weekday: "long",
  month: "long",
  day: "numeric"
}).format(new Date()).toUpperCase();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
}

function relativeTime(value) {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  return `${Math.floor(hours / 24)} day${Math.floor(hours / 24) === 1 ? "" : "s"} ago`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload;
}

function setConnectionStatus(connected) {
  const button = document.getElementById("api-status");
  button.classList.toggle("offline", !connected);
  button.innerHTML = `<i></i> ${connected ? "Connected · Demo API" : "API offline · Retry"}`;
  button.setAttribute("aria-label", connected ? "API connected. Click to refresh." : "API offline. Click to retry.");
}

function renderMetrics(metrics) {
  document.getElementById("active-count").textContent = String(metrics.activeIncidents).padStart(2, "0");
  document.getElementById("active-foot").innerHTML = `<span class="metric-dot dot-orange"></span> ${metrics.incidentsNeedingAttention} need${metrics.incidentsNeedingAttention === 1 ? "s" : ""} attention`;
  document.getElementById("incident-pill").textContent = String(metrics.activeIncidents).padStart(2, "0");
  document.getElementById("nav-count").textContent = metrics.activeIncidents;
  document.getElementById("services-online").innerHTML = `${metrics.servicesOnline} <span class="metric-muted">/ ${metrics.servicesTotal}</span>`;
  document.getElementById("uptime-summary").innerHTML = `<span class="metric-dot dot-green"></span> ${metrics.uptime}% average uptime`;
  document.getElementById("response-time").innerHTML = `${metrics.meanLatencyMs} <span class="metric-unit">ms</span>`;
  document.getElementById("response-summary").innerHTML = `<span class="metric-dot dot-blue"></span> Simulated probe latency`;
  document.getElementById("deploy-count").textContent = metrics.deploysToday;
  document.getElementById("last-deploy").innerHTML = `<span class="metric-dot dot-blue"></span> Last deploy ${relativeTime(metrics.lastDeployAt)}`;
  const hasIncidents = metrics.activeIncidents > 0;
  document.querySelector(".status-banner").classList.toggle("attention", hasIncidents);
  document.getElementById("overall-status").textContent = hasIncidents ? "Some services need attention" : "Systems are operational";
  document.querySelector(".status-message span").textContent = hasIncidents
    ? `${metrics.activeIncidents} active incident${metrics.activeIncidents === 1 ? "" : "s"} across your infrastructure.`
    : "All services are running within normal parameters.";
}

function renderIncidents() {
  const query = document.getElementById("incident-search").value.trim().toLowerCase();
  const filter = document.getElementById("incident-filter").value;
  const incidents = dashboard.incidents.filter((incident) => {
    const matchesText = `${incident.title} ${incident.service} ${incident.id}`.toLowerCase().includes(query);
    return matchesText && (filter === "all" || incident.status === filter);
  });
  document.getElementById("incident-list").innerHTML = incidents.map((incident) => {
    const severity = escapeHtml(incident.severity);
    const status = escapeHtml(incident.status);
    const nextStatus = statuses[statuses.indexOf(incident.status) + 1];
    return `<article class="incident-card">
      <span class="incident-severity ${severity}" aria-hidden="true"></span>
      <div class="incident-main">
        <div class="incident-title-row"><button class="incident-title" data-incident="${escapeHtml(incident.id)}">${escapeHtml(incident.title)}</button><span class="severity-badge ${severity}">${severity[0].toUpperCase() + severity.slice(1)}</span></div>
        <div class="incident-meta"><span>${escapeHtml(incident.id)}</span><span>${escapeHtml(incident.service)}</span><span>${relativeTime(incident.updatedAt || incident.createdAt)}</span></div>
      </div>
      <div class="incident-actions"><span class="status-badge">${status}</span>${nextStatus ? `<button class="action-button" data-action="${escapeHtml(incident.id)}" data-next="${nextStatus}">${nextStatus === "Resolved" ? "Resolve" : "Update"}</button>` : ""}</div>
    </article>`;
  }).join("");
  document.getElementById("empty-state").hidden = incidents.length > 0;
  renderMetrics(dashboard.metrics);
}

function renderServices() {
  const services = dashboard.services;
  document.getElementById("service-list").innerHTML = services.map((service) => {
    const incidentMessage = service.incidentId ? ` · ${escapeHtml(service.incidentId)}` : "";
    return `<div class="service-row">
      <span class="service-logo logo-${escapeHtml(service.id)}">${escapeHtml(service.icon)}</span>
      <span class="service-name"><strong>${escapeHtml(service.name)}</strong><small>${escapeHtml(service.endpoint)} · ${service.latencyMs} ms</small></span>
      <span class="uptime">${Number(service.uptime).toFixed(2)}%</span>
      <span class="service-state ${service.status === "operational" ? "healthy" : "degraded"}">${service.status === "operational" ? "Operational" : `Degraded${incidentMessage}`}</span>
      <button class="action-button deploy-service" data-deploy="${escapeHtml(service.id)}" aria-label="Deploy ${escapeHtml(service.name)}">Deploy</button>
    </div>`;
  }).join("");
  document.getElementById("service-count").textContent = `${services.filter((service) => service.status === "operational").length} of ${services.length} services operational`;
  const latestCheck = services.reduce((latest, service) => service.checkedAt > latest ? service.checkedAt : latest, "");
  document.getElementById("service-checked").textContent = latestCheck ? `Checked ${relativeTime(latestCheck)}` : "No checks yet";
  const serviceSelect = document.getElementById("incident-service");
  const currentService = serviceSelect.value;
  serviceSelect.innerHTML = services.map((service) => `<option>${escapeHtml(service.name)}</option>`).join("");
  if (services.some((service) => service.name === currentService)) serviceSelect.value = currentService;
}

function renderActivity() {
  const activity = showAllActivity ? dashboard.activity : dashboard.activity.slice(0, 3);
  document.getElementById("activity-list").innerHTML = activity.map((item) => `
    <div class="activity-item"><span class="activity-icon ${escapeHtml(item.kind)}">${escapeHtml(item.icon)}</span>
      <div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.detail)} <time>· ${relativeTime(item.createdAt)}</time></p></div>
    </div>`).join("");
  const moreButton = document.getElementById("activity-more");
  moreButton.hidden = dashboard.activity.length <= 3;
  moreButton.textContent = showAllActivity ? "Show recent activity" : `Show all activity (${dashboard.activity.length})`;
}

function renderDashboard(data) {
  dashboard = data;
  renderIncidents();
  renderServices();
  renderActivity();
}

async function refreshDashboard(showError = true) {
  try {
    const data = await api("/api/dashboard");
    renderDashboard(data);
    setConnectionStatus(true);
    return true;
  } catch (error) {
    setConnectionStatus(false);
    document.getElementById("service-list").innerHTML = `<div class="service-loading error-message">${escapeHtml(error.message)} Start the app with <code>npm start</code>, then retry.</div>`;
    document.getElementById("overall-status").textContent = "Cannot reach the dashboard API";
    document.querySelector(".status-message span").textContent = "Start the Node server to load live demo data.";
    if (showError) showToast(error.message);
    return false;
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3000);
}

function closeModal() {
  document.getElementById("modal-backdrop").hidden = true;
  document.body.style.overflow = "";
}

async function performAction(button, action) {
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    showToast(error.message);
  } finally {
    button.disabled = false;
  }
}

document.getElementById("incident-search").addEventListener("input", renderIncidents);
document.getElementById("incident-filter").addEventListener("change", renderIncidents);
document.getElementById("new-incident").addEventListener("click", () => {
  document.getElementById("modal-backdrop").hidden = false;
  document.body.style.overflow = "hidden";
  document.getElementById("incident-title").focus();
});
document.getElementById("modal-close").addEventListener("click", closeModal);
document.getElementById("cancel-modal").addEventListener("click", closeModal);
document.getElementById("modal-backdrop").addEventListener("click", (event) => {
  if (event.target.id === "modal-backdrop") closeModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeModal();
});
document.getElementById("incident-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const formElement = event.currentTarget;
  const button = formElement.querySelector('button[type="submit"]');
  performAction(button, async () => {
    const form = new FormData(formElement);
    const result = await api("/api/incidents", {
      method: "POST",
      body: {
        title: form.get("title"),
        service: form.get("service"),
        severity: form.get("severity"),
        description: form.get("description")
      }
    });
    formElement.reset();
    closeModal();
    renderDashboard(result.dashboard);
    showToast(`${result.incident.id} created successfully.`);
    const createdIncident = document.querySelector(`[data-incident="${result.incident.id}"]`);
    createdIncident?.scrollIntoView({ behavior: "smooth", block: "center" });
    createdIncident?.focus({ preventScroll: true });
  });
});
document.getElementById("incident-list").addEventListener("click", (event) => {
  const action = event.target.closest("[data-action]");
  const title = event.target.closest("[data-incident]");
  if (title) {
    const incident = dashboard.incidents.find((item) => item.id === title.dataset.incident);
    if (incident) showToast(`${incident.id} · ${incident.description || incident.status}`);
    return;
  }
  if (!action) return;
  performAction(action, async () => {
    const result = await api(`/api/incidents/${encodeURIComponent(action.dataset.action)}`, {
      method: "PATCH",
      body: { status: action.dataset.next }
    });
    renderDashboard(result.dashboard);
    showToast(`${result.incident.id} moved to ${result.incident.status.toLowerCase()}.`);
  });
});
document.getElementById("view-all").addEventListener("click", () => {
  document.getElementById("incident-filter").value = "all";
  document.getElementById("incident-search").value = "";
  renderIncidents();
  document.getElementById("incidents").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("refresh-services").addEventListener("click", (event) => performAction(event.currentTarget, async () => {
  await api("/api/services/check", { method: "POST" });
  await refreshDashboard(false);
  showToast("Service health checks completed.");
}));
document.getElementById("service-list").addEventListener("click", (event) => {
  const button = event.target.closest("[data-deploy]");
  if (!button) return;
  performAction(button, async () => {
    const result = await api(`/api/services/${encodeURIComponent(button.dataset.deploy)}/deploy`, { method: "POST" });
    await refreshDashboard(false);
    showToast(`${result.service.name} deployed as v${result.service.version}.`);
  });
});
document.getElementById("activity-more").addEventListener("click", () => {
  showAllActivity = !showAllActivity;
  renderActivity();
});
document.getElementById("activity-shortcut").addEventListener("click", () => {
  document.getElementById("activity").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.getElementById("api-status").addEventListener("click", () => refreshDashboard());
document.getElementById("mobile-menu").addEventListener("click", () => document.getElementById("sidebar").classList.toggle("open"));
document.querySelectorAll(".nav-link, .sidebar-help a").forEach((link) => link.addEventListener("click", () => {
  document.getElementById("sidebar").classList.remove("open");
  document.querySelectorAll(".nav-link").forEach((navLink) => navLink.classList.toggle("active", navLink === link));
}));

refreshDashboard();
window.setInterval(() => {
  if (!document.hidden) refreshDashboard(false);
}, 20_000);
