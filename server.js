const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "dashboard.json");
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY_BYTES = 16 * 1024;
const publicFiles = new Set(["index.html", "styles.css", "app.js"]);
const SEVERITIES = new Set(["minor", "major", "critical"]);
const STATUSES = ["Investigating", "Identified", "Monitoring", "Resolved"];
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const serviceSeeds = [
  { id: "api-gateway", name: "API Gateway", endpoint: "api.northstar.io", region: "us-east-1", icon: "A", uptime: 99.99, baseLatencyMs: 84, version: "2.18.4" },
  { id: "primary-database", name: "Primary Database", endpoint: "PostgreSQL · us-east-1", region: "us-east-1", icon: "D", uptime: 99.95, baseLatencyMs: 12, version: "15.6" },
  { id: "edge-network", name: "Edge Network", endpoint: "Global · 24 regions", region: "global", icon: "C", uptime: 98.72, baseLatencyMs: 218, version: "2026.10.28" },
  { id: "auth-service", name: "Auth Service", endpoint: "auth.northstar.io", region: "us-east-1", icon: "S", uptime: 100, baseLatencyMs: 67, version: "1.42.0" },
  { id: "background-workers", name: "Background Workers", endpoint: "workers.northstar.io", region: "us-east-1", icon: "W", uptime: 99.98, baseLatencyMs: 45, version: "3.7.2" },
  { id: "object-storage", name: "Object Storage", endpoint: "assets.northstar.io", region: "us-east-1", icon: "O", uptime: 99.99, baseLatencyMs: 31, version: "1.0.0" },
  { id: "queue-service", name: "Queue Service", endpoint: "queues.northstar.io", region: "us-east-1", icon: "Q", uptime: 99.97, baseLatencyMs: 23, version: "5.2.1" },
  { id: "billing-service", name: "Billing Service", endpoint: "billing.northstar.io", region: "us-east-1", icon: "B", uptime: 99.99, baseLatencyMs: 104, version: "2.5.0" },
  { id: "notifications", name: "Notifications", endpoint: "notify.northstar.io", region: "us-east-1", icon: "N", uptime: 99.96, baseLatencyMs: 91, version: "4.1.3" }
];

function minutesAgo(minutes) {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function createInitialState() {
  return {
    incidents: [
      { id: "INC-2481", title: "Elevated latency in edge network", service: "Edge Network", severity: "major", status: "Investigating", createdAt: minutesAgo(12), owner: "Alex Morgan", description: "Latency has increased across several edge regions." },
      { id: "INC-2480", title: "Intermittent webhook delivery delays", service: "API Gateway", severity: "minor", status: "Monitoring", createdAt: minutesAgo(48), owner: "Jordan Lee", description: "Webhook retries are catching up; monitoring queue depth." },
      { id: "INC-2479", title: "Database replica lag above threshold", service: "Primary Database", severity: "critical", status: "Identified", createdAt: minutesAgo(60), owner: "Sam Rivera", description: "A read replica is lagging behind the primary." }
    ],
    services: serviceSeeds.map((service) => ({ ...service, latencyMs: service.baseLatencyMs, checkedAt: minutesAgo(1) })),
    activity: [
      { id: randomUUID(), icon: "⇧", kind: "deploy", title: "Deployment completed", detail: "API Gateway · v2.18.4", createdAt: minutesAgo(18) },
      { id: randomUUID(), icon: "✓", kind: "resolved", title: "Incident resolved", detail: "INC-2478 · Cache invalidation delay", createdAt: minutesAgo(34) },
      { id: randomUUID(), icon: "◎", kind: "alert", title: "Incident updated", detail: "INC-2481 · Edge Network", createdAt: minutesAgo(12) }
    ],
    deploysToday: 12,
    lastDeployAt: minutesAgo(18)
  };
}

let state;
let mutationQueue = Promise.resolve();

async function loadState() {
  try {
    const saved = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
    if (!Array.isArray(saved.incidents) || !Array.isArray(saved.services) || !Array.isArray(saved.activity)) {
      throw new Error("Dashboard data is missing required collections.");
    }
    return saved;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return createInitialState();
  }
}

function persistState() {
  const temporary = `${DATA_FILE}.tmp`;
  return fs.mkdir(DATA_DIR, { recursive: true })
    .then(() => fs.writeFile(temporary, JSON.stringify(state, null, 2), "utf8"))
    .then(() => fs.rename(temporary, DATA_FILE));
}

function addActivity(title, detail, kind = "alert", icon = "◎") {
  state.activity.unshift({ id: randomUUID(), title, detail, kind, icon, createdAt: new Date().toISOString() });
  state.activity = state.activity.slice(0, 100);
}

function activeIncidents() {
  return state.incidents.filter((incident) => incident.status !== "Resolved");
}

function getServices() {
  return state.services.map((service) => {
    const incident = activeIncidents().find((item) => item.service === service.name);
    return {
      id: service.id,
      name: service.name,
      endpoint: service.endpoint,
      region: service.region,
      icon: service.icon,
      uptime: service.uptime,
      latencyMs: service.latencyMs,
      version: service.version,
      checkedAt: service.checkedAt,
      status: incident ? "degraded" : "operational",
      incidentId: incident ? incident.id : null
    };
  });
}

function dashboardData() {
  const services = getServices();
  const onlineCount = services.filter((service) => service.status === "operational").length;
  const meanLatency = Math.round(services.reduce((total, service) => total + service.latencyMs, 0) / services.length);
  return {
    incidents: activeIncidents().sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    services,
    activity: state.activity,
    metrics: {
      activeIncidents: activeIncidents().length,
      incidentsNeedingAttention: activeIncidents().filter((incident) => incident.status === "Investigating").length,
      servicesOnline: onlineCount,
      servicesTotal: services.length,
      uptime: (services.reduce((total, service) => total + service.uptime, 0) / services.length).toFixed(2),
      meanLatencyMs: meanLatency,
      deploysToday: state.deploysToday,
      lastDeployAt: state.lastDeployAt
    },
    updatedAt: new Date().toISOString()
  };
}

function sendJson(response, statusCode, data) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(Object.assign(new Error("Request body is too large."), { statusCode: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { statusCode: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function mutate(change) {
  const operation = mutationQueue.then(async () => {
    const result = change();
    await persistState();
    return result;
  });
  mutationQueue = operation.catch(() => {});
  return operation;
}

async function serveStatic(pathname, response) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return sendJson(response, 400, { error: "Malformed URL path." });
  }
  const relativePath = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (!publicFiles.has(relativePath)) return sendJson(response, 404, { error: "File not found." });
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    return sendJson(response, 403, { error: "Path is outside the application." });
  }
  try {
    const content = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "X-Content-Type-Options": "nosniff"
    });
    response.end(content);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EISDIR") return sendJson(response, 404, { error: "File not found." });
    throw error;
  }
}

async function handleApi(request, response, pathname) {
  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok", service: "orbit-api", timestamp: new Date().toISOString() });
  }
  if (request.method === "GET" && pathname === "/api/dashboard") {
    return sendJson(response, 200, dashboardData());
  }
  if (request.method === "GET" && pathname === "/api/services") {
    return sendJson(response, 200, { services: getServices(), checkedAt: new Date().toISOString() });
  }
  if (request.method === "POST" && pathname === "/api/services/check") {
    await mutate(() => {
      for (const service of state.services) {
        const variation = Math.round((Math.random() - 0.5) * Math.max(12, service.baseLatencyMs * 0.18));
        service.latencyMs = Math.max(4, service.baseLatencyMs + variation);
        service.checkedAt = new Date().toISOString();
      }
    });
    return sendJson(response, 200, { services: getServices(), checkedAt: new Date().toISOString() });
  }

  const deployMatch = pathname.match(/^\/api\/services\/([a-z0-9-]+)\/deploy$/);
  if (request.method === "POST" && deployMatch) {
    const service = state.services.find((item) => item.id === deployMatch[1]);
    if (!service) return sendJson(response, 404, { error: "Service not found." });
    await mutate(() => {
      const currentVersion = Number(service.version.split(".").pop()) || 0;
      const pieces = service.version.split(".");
      pieces[pieces.length - 1] = String(currentVersion + 1);
      service.version = pieces.join(".");
      state.deploysToday += 1;
      state.lastDeployAt = new Date().toISOString();
      addActivity("Deployment completed", `${service.name} · v${service.version}`, "deploy", "⇧");
    });
    return sendJson(response, 200, { service: getServices().find((item) => item.id === service.id), metrics: dashboardData().metrics });
  }

  if (request.method === "POST" && pathname === "/api/incidents") {
    const body = await readJson(request);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    const service = typeof body.service === "string" ? body.service : "";
    const severity = typeof body.severity === "string" ? body.severity : "";
    if (!title || title.length > 100) return sendJson(response, 400, { error: "Incident title is required and must be 100 characters or fewer." });
    if (!state.services.some((item) => item.name === service)) return sendJson(response, 400, { error: "Choose a valid service." });
    if (!SEVERITIES.has(severity)) return sendJson(response, 400, { error: "Choose a valid severity." });
    let incident;
    await mutate(() => {
      const nextId = Math.max(2481, ...state.incidents.map((item) => Number(item.id.replace(/\D/g, "")) || 0)) + 1;
      incident = {
        id: `INC-${nextId}`,
        title,
        service,
        severity,
        status: "Investigating",
        createdAt: new Date().toISOString(),
        owner: "Alex Morgan",
        description: typeof body.description === "string" ? body.description.trim().slice(0, 1000) : ""
      };
      state.incidents.push(incident);
      addActivity("Incident created", `${incident.id} · ${incident.service}`);
    });
    return sendJson(response, 201, { incident, dashboard: dashboardData() });
  }

  const incidentMatch = pathname.match(/^\/api\/incidents\/(INC-\d+)$/);
  if (request.method === "PATCH" && incidentMatch) {
    const body = await readJson(request);
    let updatedIncident;
    let errorMessage;
    await mutate(() => {
      const incident = state.incidents.find((item) => item.id === incidentMatch[1]);
      if (!incident) {
        errorMessage = "Incident not found.";
        return;
      }
      const currentIndex = STATUSES.indexOf(incident.status);
      const nextStatus = STATUSES[currentIndex + 1];
      if (!nextStatus || body.status !== nextStatus) {
        errorMessage = `Incident can only move to ${nextStatus || "no further status"}.`;
        return;
      }
      incident.status = nextStatus;
      incident.updatedAt = new Date().toISOString();
      updatedIncident = incident;
      addActivity(nextStatus === "Resolved" ? "Incident resolved" : "Incident updated", `${incident.id} · ${nextStatus}`, nextStatus === "Resolved" ? "resolved" : "alert", nextStatus === "Resolved" ? "✓" : "◎");
    });
    if (errorMessage) return sendJson(response, errorMessage === "Incident not found." ? 404 : 400, { error: errorMessage });
    return sendJson(response, 200, { incident: updatedIncident, dashboard: dashboardData() });
  }

  return sendJson(response, 404, { error: "API route not found." });
}

async function handleRequest(request, response) {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) return await handleApi(request, response, url.pathname);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return sendJson(response, 405, { error: "Method not allowed." });
    }
    return await serveStatic(url.pathname, response);
  } catch (error) {
    console.error("Request failed:", error);
    if (!response.headersSent) sendJson(response, error.statusCode || 500, { error: error.statusCode ? error.message : "The server could not complete the request." });
    else response.destroy();
  }
}

async function start() {
  state = await loadState();
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log(`Orbit dashboard ready at http://localhost:${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
  });
  server.on("error", (error) => {
    console.error("Could not start Orbit server:", error);
    process.exitCode = 1;
  });
}

start().catch((error) => {
  console.error("Could not load dashboard state:", error);
  process.exitCode = 1;
});
