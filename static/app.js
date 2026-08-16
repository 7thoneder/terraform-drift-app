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
  stateMessage: document.getElementById("stateMessage"),
  storageAccountSelect: document.getElementById("storageAccountSelect"),
  containerSelect: document.getElementById("containerSelect"),
  blobPrefix: document.getElementById("blobPrefix"),
  stateBlobSelect: document.getElementById("stateBlobSelect"),
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
  nodes.terraformDetail.textContent = status.terraform?.ok
    ? `Terraform ${status.terraform.version}`
    : status.terraform?.message || "Terraform unavailable";
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
    const pathHint = status.azure?.path ? ` Found path: ${status.azure.path}` : "";
    nodes.azureDetail.textContent = `${status.azure?.message || "Azure CLI unavailable"}${pathHint}`;
    nodes.azureConnectionMessage.textContent = "Not logged into Azure yet. Start login, complete the browser sign-in, then refresh subscriptions.";
  }
  const stateConfig = status.state || {};
  if (stateConfig.source === "azure-state" && stateConfig.accountName && stateConfig.containerName && stateConfig.blobName) {
    nodes.stateMessage.textContent = `Using ${stateConfig.accountName}/${stateConfig.containerName}/${stateConfig.blobName} as the Terraform state source.`;
  } else {
    nodes.stateMessage.textContent = "Choose a `.tfstate` blob from Azure Storage to load managed resources from remote state.";
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

async function loadStorageAccounts() {
  const button = document.getElementById("loadStorageAccounts");
  button.textContent = "Loading...";
  nodes.storageAccountSelect.innerHTML = '<option value="">Loading accounts...</option>';
  try {
    const result = await api("/api/azure/storage/accounts");
    if (!result.ok) {
      nodes.storageAccountSelect.innerHTML = '<option value="">Could not load accounts</option>';
      nodes.stateMessage.textContent = result.error || "Could not load storage accounts.";
      return;
    }
    if (!result.accounts.length) {
      nodes.storageAccountSelect.innerHTML = '<option value="">No storage accounts found</option>';
      nodes.stateMessage.textContent = "No storage accounts were found in the selected subscription.";
      return;
    }
    nodes.storageAccountSelect.innerHTML = "";
    result.accounts.forEach((account) => {
      const option = document.createElement("option");
      option.value = account.name;
      option.dataset.resourceGroup = account.resourceGroup || "";
      option.textContent = `${account.name} (${account.resourceGroup || "no resource group"})${account.isConfigured ? " - saved" : ""}`;
      option.selected = account.isConfigured;
      nodes.storageAccountSelect.appendChild(option);
    });
    nodes.stateMessage.textContent = "Choose the storage account that contains your Terraform backend container.";
  } catch (error) {
    nodes.storageAccountSelect.innerHTML = '<option value="">Could not load accounts</option>';
    nodes.stateMessage.textContent = error.message;
  } finally {
    button.textContent = "Load accounts";
  }
}

async function loadContainers() {
  const accountName = nodes.storageAccountSelect.value;
  if (!accountName) {
    nodes.stateMessage.textContent = "Select a storage account first.";
    return;
  }
  const button = document.getElementById("loadContainers");
  button.textContent = "Loading...";
  nodes.containerSelect.innerHTML = '<option value="">Loading containers...</option>';
  try {
    const query = new URLSearchParams({ accountName });
    const result = await api(`/api/azure/storage/containers?${query.toString()}`);
    if (!result.ok) {
      nodes.containerSelect.innerHTML = '<option value="">Could not load containers</option>';
      nodes.stateMessage.textContent = result.error || "Could not load containers.";
      return;
    }
    if (!result.containers.length) {
      nodes.containerSelect.innerHTML = '<option value="">No containers found</option>';
      nodes.stateMessage.textContent = "No blob containers were found for this storage account.";
      return;
    }
    nodes.containerSelect.innerHTML = "";
    result.containers.forEach((container) => {
      const option = document.createElement("option");
      option.value = container.name;
      option.textContent = `${container.name}${container.isConfigured ? " - saved" : ""}`;
      option.selected = container.isConfigured;
      nodes.containerSelect.appendChild(option);
    });
    nodes.stateMessage.textContent = "Choose the backend container, then find `.tfstate` blobs.";
  } catch (error) {
    nodes.containerSelect.innerHTML = '<option value="">Could not load containers</option>';
    nodes.stateMessage.textContent = error.message;
  } finally {
    button.textContent = "Load containers";
  }
}

async function loadStateBlobs() {
  const accountName = nodes.storageAccountSelect.value;
  const containerName = nodes.containerSelect.value;
  if (!accountName || !containerName) {
    nodes.stateMessage.textContent = "Select a storage account and container first.";
    return;
  }
  const button = document.getElementById("loadStateBlobs");
  button.textContent = "Finding...";
  nodes.stateBlobSelect.innerHTML = '<option value="">Finding state blobs...</option>';
  try {
    const query = new URLSearchParams({ accountName, containerName, prefix: nodes.blobPrefix.value.trim() });
    const result = await api(`/api/azure/storage/blobs?${query.toString()}`);
    if (!result.ok) {
      nodes.stateBlobSelect.innerHTML = '<option value="">Could not load state blobs</option>';
      nodes.stateMessage.textContent = result.error || "Could not load state blobs.";
      return;
    }
    if (!result.blobs.length) {
      nodes.stateBlobSelect.innerHTML = '<option value="">No .tfstate blobs found</option>';
      nodes.stateMessage.textContent = "No `.tfstate` blobs matched that container and prefix.";
      return;
    }
    nodes.stateBlobSelect.innerHTML = "";
    result.blobs.forEach((blob) => {
      const option = document.createElement("option");
      option.value = blob.name;
      option.textContent = `${blob.name} (${formatBytes(blob.size)})${blob.isConfigured ? " - saved" : ""}`;
      option.selected = blob.isConfigured;
      nodes.stateBlobSelect.appendChild(option);
    });
    nodes.stateMessage.textContent = "Choose a state blob and save it as the app's resource inventory source.";
  } catch (error) {
    nodes.stateBlobSelect.innerHTML = '<option value="">Could not load state blobs</option>';
    nodes.stateMessage.textContent = error.message;
  } finally {
    button.textContent = "Find state blobs";
  }
}

async function selectStateBlob() {
  const accountName = nodes.storageAccountSelect.value;
  const containerName = nodes.containerSelect.value;
  const blobName = nodes.stateBlobSelect.value;
  if (!accountName || !containerName || !blobName) {
    nodes.stateMessage.textContent = "Select an account, container, and state blob first.";
    return;
  }
  const button = document.getElementById("selectStateBlob");
  button.textContent = "Saving...";
  try {
    const result = await api("/api/state/select", {
      method: "POST",
      body: JSON.stringify({ accountName, containerName, blobName }),
    });
    if (!result.ok) {
      nodes.stateMessage.textContent = result.error || "Could not select state blob.";
      return;
    }
    nodes.stateMessage.textContent = result.message;
    await loadStatus();
    await scan();
  } catch (error) {
    nodes.stateMessage.textContent = error.message;
  } finally {
    button.textContent = "Use state blob";
  }
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 102.4) / 10} KB`;
  return `${Math.round(bytes / 104857.6) / 10} MB`;
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
document.getElementById("loadStorageAccounts").addEventListener("click", loadStorageAccounts);
document.getElementById("loadContainers").addEventListener("click", loadContainers);
document.getElementById("loadStateBlobs").addEventListener("click", loadStateBlobs);
document.getElementById("selectStateBlob").addEventListener("click", selectStateBlob);
document.getElementById("scan").addEventListener("click", scan);
document.getElementById("generatePlan").addEventListener("click", generatePlan);
document.getElementById("loadActivity").addEventListener("click", loadActivity);
nodes.search.addEventListener("input", render);
nodes.category.addEventListener("change", render);
nodes.action.addEventListener("change", generatePlan);

loadStatus().then(() => {
  loadSubscriptions();
  loadStorageAccounts();
  scan();
});
