const state = {
  resources: [],
  selectedId: "",
  status: null,
};

const nodes = {
  mode: document.getElementById("mode"),
  workdir: document.getElementById("workdir"),
  terraformStatus: document.getElementById("terraformStatus"),
  terraformDetail: document.getElementById("terraformDetail"),
  azureStatus: document.getElementById("azureStatus"),
  azureDetail: document.getElementById("azureDetail"),
  azureConnectionMessage: document.getElementById("azureConnectionMessage"),
  subscriptionSelect: document.getElementById("subscriptionSelect"),
  driftCount: document.getElementById("driftCount"),
  scanTime: document.getElementById("scanTime"),
  resources: document.getElementById("resources"),
  visibleCount: document.getElementById("visibleCount"),
  search: document.getElementById("search"),
  category: document.getElementById("category"),
  action: document.getElementById("action"),
  emptyState: document.getElementById("emptyState"),
  detail: document.getElementById("detail"),
  resourceName: document.getElementById("resourceName"),
  resourceAddress: document.getElementById("resourceAddress"),
  severity: document.getElementById("severity"),
  owner: document.getElementById("owner"),
  detectedBy: document.getElementById("detectedBy"),
  recommendation: document.getElementById("recommendation"),
  diffRows: document.getElementById("diffRows"),
  planSummary: document.getElementById("planSummary"),
  planCommands: document.getElementById("planCommands"),
  activity: document.getElementById("activity"),
};

function selectedResource() {
  return state.resources.find((item) => item.id === state.selectedId) || null;
}

function filteredResources() {
  const query = nodes.search.value.trim().toLowerCase();
  const category = nodes.category.value;
  return state.resources.filter((resource) => {
    const inCategory = category === "all" || resource.category === category;
    const haystack = [resource.name, resource.type, resource.address, resource.summary].join(" ").toLowerCase();
    return inCategory && (!query || haystack.includes(query));
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

function renderStatus() {
  const status = state.status;
  if (!status) return;
  nodes.mode.textContent = status.mode || "sample";
  nodes.workdir.textContent = status.terraformWorkdir || "No Terraform workdir configured";
  nodes.terraformStatus.textContent = status.terraform?.ok ? "ready" : "not ready";
  nodes.terraformDetail.textContent = status.terraform?.ok ? `Terraform ${status.terraform.version}` : status.terraform?.message || "Terraform unavailable";
  nodes.azureStatus.textContent = status.azure?.ok ? "connected" : "not connected";
  if (status.azure?.ok) {
    const account = status.azure.account;
    const configured = status.azure.configuredSubscriptionId;
    const configuredText = configured && configured !== account.subscriptionId ? `; configured ${configured}` : "";
    nodes.azureDetail.textContent = `${account.name || "subscription"} (${account.subscriptionId || "unknown"})${configuredText}`;
    nodes.azureConnectionMessage.textContent = configured
      ? `Using subscription ${configured}. Azure CLI active subscription is ${account.subscriptionId || "unknown"}.`
      : "Azure CLI is logged in. Choose a subscription to save it for this app.";
  } else {
    nodes.azureDetail.textContent = status.azure?.message || "Azure CLI unavailable";
    nodes.azureConnectionMessage.textContent = "Not logged into Azure yet. Start login, complete the browser sign-in, then refresh subscriptions.";
  }
}

function renderResources() {
  const visible = filteredResources();
  nodes.resources.innerHTML = "";
  nodes.visibleCount.textContent = `${visible.length} shown`;
  visible.forEach((resource) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "resource-button";
    button.setAttribute("aria-pressed", String(resource.id === state.selectedId));
    button.innerHTML = `
      <strong>${escapeHtml(resource.name)}</strong>
      <span class="resource-meta">${escapeHtml(resource.type)} - ${escapeHtml(resource.severity)} risk</span>
      <span class="resource-meta">${escapeHtml(resource.summary)}</span>
    `;
    button.addEventListener("click", () => {
      state.selectedId = resource.id;
      nodes.planSummary.textContent = "Choose an action and generate a correction plan.";
      nodes.planCommands.textContent = "";
      nodes.activity.innerHTML = '<p class="muted">Load Activity Log events for attribution.</p>';
      render();
    });
    nodes.resources.appendChild(button);
  });
}

function renderDetail() {
  const resource = selectedResource();
  nodes.driftCount.textContent = String(state.resources.length);
  if (!resource) {
    nodes.emptyState.classList.remove("hidden");
    nodes.detail.classList.add("hidden");
    return;
  }
  nodes.emptyState.classList.add("hidden");
  nodes.detail.classList.remove("hidden");
  nodes.resourceName.textContent = `${resource.name} - ${resource.type}`;
  nodes.resourceAddress.textContent = resource.address;
  nodes.severity.textContent = `${resource.severity} risk`;
  nodes.severity.className = `badge ${resource.severity}`;
  nodes.owner.textContent = resource.owner || "unassigned";
  nodes.detectedBy.textContent = resource.detectedBy || "unknown";
  nodes.recommendation.textContent = labelAction(resource.recommendation);
  nodes.diffRows.innerHTML = "";
  resource.diffs.forEach((diff) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td><code>${escapeHtml(diff.path)}</code></td>
      <td><code>${escapeHtml(String(diff.desired))}</code></td>
      <td><code>${escapeHtml(String(diff.current))}</code></td>
    `;
    nodes.diffRows.appendChild(row);
  });
}

function render() {
  renderStatus();
  renderResources();
  renderDetail();
}

function labelAction(value) {
  if (value === "accept") return "Accept into Terraform";
  if (value === "suppress") return "Suppress";
  return "Restore Azure";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function loadStatus() {
  nodes.terraformStatus.textContent = "checking";
  nodes.azureStatus.textContent = "checking";
  try {
    state.status = await api("/api/status");
  } catch (error) {
    state.status = {
      mode: "unknown",
      terraform: { ok: false, message: error.message },
      azure: { ok: false, message: error.message },
    };
  }
  render();
}

async function loginAzure() {
  const button = document.getElementById("loginAzure");
  button.textContent = "Starting login...";
  nodes.azureConnectionMessage.textContent = "Starting Azure login in your browser...";
  try {
    const result = await api("/api/azure/login", {
      method: "POST",
      body: JSON.stringify({}),
    });
    nodes.azureConnectionMessage.textContent = result.ok ? result.message : result.error || "Azure login could not be started.";
  } catch (error) {
    nodes.azureConnectionMessage.textContent = error.message;
  } finally {
    button.textContent = "Log into Azure";
  }
}

async function loadSubscriptions() {
  const button = document.getElementById("loadSubscriptions");
  button.textContent = "Loading...";
  nodes.subscriptionSelect.innerHTML = '<option value="">Loading subscriptions...</option>';
  try {
    const result = await api("/api/azure/subscriptions");
    if (!result.ok) {
      nodes.subscriptionSelect.innerHTML = '<option value="">Could not load subscriptions</option>';
      nodes.azureConnectionMessage.textContent = result.error || "Could not load subscriptions.";
      return;
    }
    if (!result.subscriptions.length) {
      nodes.subscriptionSelect.innerHTML = '<option value="">No subscriptions found</option>';
      nodes.azureConnectionMessage.textContent = "No subscriptions were returned by Azure CLI for this account.";
      return;
    }
    nodes.subscriptionSelect.innerHTML = "";
    result.subscriptions.forEach((subscription) => {
      const option = document.createElement("option");
      option.value = subscription.id;
      const markers = [
        subscription.isDefault ? "active" : "",
        subscription.isConfigured ? "saved" : "",
        subscription.state && subscription.state !== "Enabled" ? subscription.state : "",
      ].filter(Boolean);
      option.textContent = `${subscription.name || "Unnamed subscription"} (${subscription.id})${markers.length ? ` - ${markers.join(", ")}` : ""}`;
      option.selected = subscription.isConfigured || (!result.configuredSubscriptionId && subscription.isDefault);
      nodes.subscriptionSelect.appendChild(option);
    });
    nodes.azureConnectionMessage.textContent = "Choose a subscription and save it for Terraform scans and Azure Activity Log queries.";
  } catch (error) {
    nodes.subscriptionSelect.innerHTML = '<option value="">Could not load subscriptions</option>';
    nodes.azureConnectionMessage.textContent = error.message;
  } finally {
    button.textContent = "Refresh subscriptions";
  }
}

async function selectSubscription() {
  const subscriptionId = nodes.subscriptionSelect.value;
  if (!subscriptionId) {
    nodes.azureConnectionMessage.textContent = "Select a subscription first.";
    return;
  }
  const button = document.getElementById("selectSubscription");
  button.textContent = "Saving...";
  try {
    const result = await api("/api/azure/subscription", {
      method: "POST",
      body: JSON.stringify({ subscriptionId }),
    });
    nodes.azureConnectionMessage.textContent = result.ok ? result.message : result.error || "Could not select subscription.";
    await loadStatus();
    await loadSubscriptions();
  } catch (error) {
    nodes.azureConnectionMessage.textContent = error.message;
  } finally {
    button.textContent = "Use subscription";
  }
}

async function scan() {
  document.getElementById("scan").textContent = "Scanning...";
  try {
    const result = await api("/api/scan");
    if (!result.ok) {
      nodes.resources.innerHTML = `<p class="muted">${escapeHtml(result.error || "Scan failed")}</p>`;
      return;
    }
    state.resources = result.resources || [];
    state.selectedId = state.resources[0]?.id || "";
    nodes.scanTime.textContent = result.scannedAt ? `Scanned ${new Date(result.scannedAt).toLocaleString()}` : "Scan complete";
    render();
  } finally {
    document.getElementById("scan").textContent = "Scan drift";
  }
}

async function generatePlan() {
  const resource = selectedResource();
  if (!resource) return;
  nodes.planSummary.textContent = "Generating correction plan...";
  nodes.planCommands.textContent = "";
  const result = await api("/api/actions/plan", {
    method: "POST",
    body: JSON.stringify({ resource, action: nodes.action.value }),
  });
  nodes.planSummary.textContent = result.summary;
  nodes.planCommands.textContent = result.commands.join("\n");
}

async function loadActivity() {
  const resource = selectedResource();
  if (!resource) return;
  nodes.activity.innerHTML = '<p class="muted">Loading Azure Activity Log events...</p>';
  const query = new URLSearchParams({ resourceId: resource.resourceId || "" });
  const result = await api(`/api/activity?${query.toString()}`);
  if (!result.ok) {
    nodes.activity.innerHTML = `<p class="muted">${escapeHtml(result.error || "Could not load events")}</p>`;
    return;
  }
  if (!result.events.length) {
    nodes.activity.innerHTML = '<p class="muted">No recent events found for this resource.</p>';
    return;
  }
  nodes.activity.innerHTML = "";
  result.events.forEach((event) => {
    const item = document.createElement("div");
    item.className = "activity-event";
    item.innerHTML = `
      <strong>${escapeHtml(event.operation || "operation")}</strong>
      <span class="muted">${escapeHtml(event.caller || "unknown caller")} - ${escapeHtml(event.status || "unknown")} - ${escapeHtml(event.time || "unknown time")}</span>
    `;
    nodes.activity.appendChild(item);
  });
}

document.getElementById("refreshStatus").addEventListener("click", loadStatus);
document.getElementById("loginAzure").addEventListener("click", loginAzure);
document.getElementById("loadSubscriptions").addEventListener("click", loadSubscriptions);
document.getElementById("selectSubscription").addEventListener("click", selectSubscription);
document.getElementById("scan").addEventListener("click", scan);
document.getElementById("generatePlan").addEventListener("click", generatePlan);
document.getElementById("loadActivity").addEventListener("click", loadActivity);
nodes.search.addEventListener("input", render);
nodes.category.addEventListener("change", render);
nodes.action.addEventListener("change", generatePlan);

loadStatus().then(() => {
  loadSubscriptions();
  scan();
});
