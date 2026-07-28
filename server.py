from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import re
import subprocess
import sys
import tempfile
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any


ROOT = pathlib.Path(__file__).resolve().parent
STATIC = ROOT / "static"


def load_env() -> dict[str, str]:
    env = dict(os.environ)
    env_file = ROOT / ".env"
    if env_file.exists():
        for raw_line in env_file.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            env[key.strip()] = value.strip().strip('"')
    return env


CONFIG = load_env()


def app_env() -> dict[str, str]:
    env = dict(os.environ)
    subscription_id = CONFIG.get("AZURE_SUBSCRIPTION_ID", "")
    if subscription_id:
        env["AZURE_SUBSCRIPTION_ID"] = subscription_id
        env["ARM_SUBSCRIPTION_ID"] = subscription_id
    return env


def save_env_value(key: str, value: str) -> None:
    env_file = ROOT / ".env"
    lines = env_file.read_text(encoding="utf-8").splitlines() if env_file.exists() else []
    updated = False
    output = []
    for line in lines:
        if line.strip().startswith("#") or "=" not in line:
            output.append(line)
            continue
        existing_key, _ = line.split("=", 1)
        if existing_key.strip() == key:
            output.append(f"{key}={value}")
            updated = True
        else:
            output.append(line)
    if not updated:
        output.append(f"{key}={value}")
    env_file.write_text("\n".join(output) + "\n", encoding="utf-8")
    CONFIG[key] = value


def now_iso() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat()


def run_command(args: list[str], cwd: str | None = None, timeout: int = 180, env: dict[str, str] | None = None) -> dict[str, Any]:
    try:
        proc = subprocess.run(
            args,
            cwd=cwd,
            env=env,
            text=True,
            capture_output=True,
            timeout=timeout,
            check=False,
        )
        return {
            "ok": proc.returncode == 0,
            "returncode": proc.returncode,
            "stdout": proc.stdout,
            "stderr": proc.stderr,
            "command": args,
        }
    except FileNotFoundError:
        return {"ok": False, "returncode": 127, "stdout": "", "stderr": f"{args[0]} was not found on PATH", "command": args}
    except subprocess.TimeoutExpired as exc:
        return {
            "ok": False,
            "returncode": 124,
            "stdout": exc.stdout or "",
            "stderr": f"Command timed out after {timeout}s",
            "command": args,
        }


def sample_resources() -> list[dict[str, Any]]:
    return [
        {
            "id": "module.network.azurerm_network_security_group.web",
            "address": "module.network.azurerm_network_security_group.web",
            "name": "web-nsg",
            "type": "azurerm_network_security_group",
            "category": "security",
            "severity": "high",
            "owner": "platform-network",
            "detectedBy": "sample refresh-only plan",
            "recommendation": "restore",
            "summary": "Inbound SSH was opened from the internet.",
            "resourceId": "/subscriptions/000/resourceGroups/rg-network/providers/Microsoft.Network/networkSecurityGroups/web-nsg",
            "diffs": [
                {"path": "security_rule.ssh.source_address_prefix", "desired": "10.20.0.0/16", "current": "*"},
                {"path": "security_rule.ssh.priority", "desired": "4096", "current": "120"},
                {"path": "tags.change_ticket", "desired": "CHG-1842", "current": "missing"},
            ],
        },
        {
            "id": "module.identity.azurerm_key_vault.payments",
            "address": "module.identity.azurerm_key_vault.payments",
            "name": "payments-kv",
            "type": "azurerm_key_vault",
            "category": "security",
            "severity": "high",
            "owner": "security",
            "detectedBy": "sample Azure Policy event",
            "recommendation": "restore",
            "summary": "Purge protection was disabled outside Terraform.",
            "resourceId": "/subscriptions/000/resourceGroups/rg-identity/providers/Microsoft.KeyVault/vaults/payments-kv",
            "diffs": [
                {"path": "purge_protection_enabled", "desired": "true", "current": "false"},
                {"path": "soft_delete_retention_days", "desired": "90", "current": "7"},
            ],
        },
        {
            "id": "module.compute.azurerm_linux_virtual_machine_scale_set.worker",
            "address": "module.compute.azurerm_linux_virtual_machine_scale_set.worker",
            "name": "worker-vmss",
            "type": "azurerm_linux_virtual_machine_scale_set",
            "category": "cost",
            "severity": "medium",
            "owner": "app-runtime",
            "detectedBy": "sample daily drift scan",
            "recommendation": "accept",
            "summary": "Instance count was raised during an incident and should stay.",
            "resourceId": "/subscriptions/000/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachineScaleSets/worker-vmss",
            "diffs": [{"path": "instances", "desired": "4", "current": "7"}],
        },
    ]


def short_name(address: str, change: dict[str, Any]) -> str:
    values = change.get("change", {}).get("after") or change.get("change", {}).get("before") or {}
    for key in ("name", "resource_group_name"):
        if isinstance(values, dict) and values.get(key):
            return str(values[key])
    return address.split(".")[-1]


def find_resource_id(change: dict[str, Any]) -> str:
    values = change.get("change", {}).get("after") or change.get("change", {}).get("before") or {}
    if isinstance(values, dict):
        value = values.get("id")
        if isinstance(value, str):
            return value
    return ""


def flatten(value: Any, prefix: str = "") -> dict[str, Any]:
    if isinstance(value, dict):
        output: dict[str, Any] = {}
        for key, child in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            output.update(flatten(child, path))
        return output
    if isinstance(value, list):
        output = {}
        for index, child in enumerate(value):
            path = f"{prefix}[{index}]"
            output.update(flatten(child, path))
        return output
    return {prefix: value}


def classify(address: str, resource_type: str, diffs: list[dict[str, str]]) -> tuple[str, str, str]:
    text = " ".join([address, resource_type] + [d["path"] for d in diffs]).lower()
    if any(term in text for term in ("security", "key_vault", "network_security", "firewall", "public_network", "purge")):
        return "security", "high", "restore"
    if any(term in text for term in ("sku", "size", "capacity", "instances", "tier")):
        return "cost", "medium", "accept"
    if "tag" in text:
        return "tagging", "low", "accept"
    return "general", "medium", "restore"


def parse_plan(plan: dict[str, Any]) -> list[dict[str, Any]]:
    resources: list[dict[str, Any]] = []
    for change in plan.get("resource_changes", []):
        actions = change.get("change", {}).get("actions", [])
        if actions == ["no-op"] or not actions:
            continue
        before = flatten(change.get("change", {}).get("before") or {})
        after = flatten(change.get("change", {}).get("after") or {})
        keys = sorted(set(before) | set(after))
        diffs = []
        for key in keys:
            if before.get(key) != after.get(key):
                diffs.append({
                    "path": key,
                    "desired": json.dumps(after.get(key), default=str) if not isinstance(after.get(key), str) else after.get(key),
                    "current": json.dumps(before.get(key), default=str) if not isinstance(before.get(key), str) else before.get(key),
                })
        if not diffs:
            diffs = [{"path": "resource", "desired": ",".join(actions), "current": "changed"}]
        address = change.get("address", "unknown")
        resource_type = change.get("type", "unknown")
        category, severity, recommendation = classify(address, resource_type, diffs)
        resources.append({
            "id": address,
            "address": address,
            "name": short_name(address, change),
            "type": resource_type,
            "category": category,
            "severity": severity,
            "owner": "unassigned",
            "detectedBy": "terraform plan -refresh-only",
            "recommendation": recommendation,
            "summary": f"{len(diffs)} drifted attribute{'s' if len(diffs) != 1 else ''} detected.",
            "resourceId": find_resource_id(change),
            "diffs": diffs[:25],
            "actions": actions,
        })
    return resources


def scan_live() -> dict[str, Any]:
    workdir = CONFIG.get("TERRAFORM_WORKDIR", "")
    if not workdir or not pathlib.Path(workdir).exists():
        return {"ok": False, "error": "TERRAFORM_WORKDIR is not set or does not exist.", "resources": []}

    init = run_command(["terraform", "init", "-input=false"], cwd=workdir, timeout=300, env=app_env())
    if not init["ok"]:
        return {"ok": False, "error": "terraform init failed", "details": init, "resources": []}

    workspace = CONFIG.get("TERRAFORM_WORKSPACE", "")
    if workspace:
        selected = run_command(["terraform", "workspace", "select", workspace], cwd=workdir, env=app_env())
        if not selected["ok"]:
            return {"ok": False, "error": "terraform workspace select failed", "details": selected, "resources": []}

    with tempfile.TemporaryDirectory() as tmp:
        plan_path = str(pathlib.Path(tmp) / "drift.tfplan")
        plan = run_command(["terraform", "plan", "-refresh-only", "-out", plan_path], cwd=workdir, timeout=600, env=app_env())
        if not plan["ok"] and plan["returncode"] not in (0, 2):
            return {"ok": False, "error": "terraform plan -refresh-only failed", "details": plan, "resources": []}
        shown = run_command(["terraform", "show", "-json", plan_path], cwd=workdir, timeout=180, env=app_env())
        if not shown["ok"]:
            return {"ok": False, "error": "terraform show -json failed", "details": shown, "resources": []}
        try:
            parsed = json.loads(shown["stdout"])
        except json.JSONDecodeError as exc:
            return {"ok": False, "error": f"Could not parse Terraform JSON: {exc}", "resources": []}

    return {
        "ok": True,
        "mode": "live",
        "scannedAt": now_iso(),
        "resources": parse_plan(parsed),
        "terraformOutput": plan["stdout"][-5000:],
    }


def scan() -> dict[str, Any]:
    if CONFIG.get("DRIFT_MODE", "sample").lower() != "live":
        return {"ok": True, "mode": "sample", "scannedAt": now_iso(), "resources": sample_resources()}
    return scan_live()


def azure_status() -> dict[str, Any]:
    az = run_command(["az", "account", "show", "--output", "json"], timeout=30)
    if not az["ok"]:
        return {"ok": False, "message": az["stderr"] or "Azure CLI is not logged in or not installed."}
    try:
        account = json.loads(az["stdout"])
    except json.JSONDecodeError:
        return {"ok": False, "message": "Azure CLI returned unreadable account JSON."}
    return {
        "ok": True,
        "account": {"name": account.get("name"), "tenantId": account.get("tenantId"), "subscriptionId": account.get("id")},
        "configuredSubscriptionId": CONFIG.get("AZURE_SUBSCRIPTION_ID", ""),
    }


def start_azure_login() -> dict[str, Any]:
    try:
        popen_kwargs: dict[str, Any] = {}
        if os.name == "nt":
            popen_kwargs["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            popen_kwargs["start_new_session"] = True
        proc = subprocess.Popen(
            ["az", "login"],
            cwd=str(ROOT),
            stdin=subprocess.DEVNULL,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            **popen_kwargs,
        )
        return {
            "ok": True,
            "pid": proc.pid,
            "message": "Azure login started. Complete the browser sign-in, then refresh subscriptions.",
        }
    except FileNotFoundError:
        return {"ok": False, "error": "Azure CLI was not found on PATH."}
    except OSError as exc:
        return {"ok": False, "error": str(exc)}


def azure_subscriptions() -> dict[str, Any]:
    result = run_command(["az", "account", "list", "--all", "--output", "json"], timeout=60)
    if not result["ok"]:
        return {"ok": False, "error": result["stderr"] or "Could not list Azure subscriptions.", "subscriptions": []}
    try:
        accounts = json.loads(result["stdout"])
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"Could not parse Azure subscriptions: {exc}", "subscriptions": []}
    subscriptions = []
    configured = CONFIG.get("AZURE_SUBSCRIPTION_ID", "")
    for account in accounts:
        subscriptions.append({
            "id": account.get("id", ""),
            "name": account.get("name", ""),
            "tenantId": account.get("tenantId", ""),
            "state": account.get("state", ""),
            "isDefault": bool(account.get("isDefault")),
            "isConfigured": bool(configured and account.get("id") == configured),
        })
    return {"ok": True, "configuredSubscriptionId": configured, "subscriptions": subscriptions}


def select_subscription(subscription_id: str) -> dict[str, Any]:
    if not subscription_id:
        return {"ok": False, "error": "subscriptionId is required."}
    result = run_command(["az", "account", "set", "--subscription", subscription_id], timeout=60)
    if not result["ok"]:
        return {"ok": False, "error": result["stderr"] or "Could not select Azure subscription."}
    save_env_value("AZURE_SUBSCRIPTION_ID", subscription_id)
    return {"ok": True, "subscriptionId": subscription_id, "message": "Subscription selected and saved to .env."}


def terraform_status() -> dict[str, Any]:
    tf = run_command(["terraform", "version", "-json"], timeout=30)
    if not tf["ok"]:
        return {"ok": False, "message": tf["stderr"] or "Terraform CLI is not installed."}
    try:
        version = json.loads(tf["stdout"]).get("terraform_version")
    except json.JSONDecodeError:
        version = tf["stdout"].splitlines()[0] if tf["stdout"] else "unknown"
    return {"ok": True, "version": version}


def activity_for(resource_id: str) -> dict[str, Any]:
    if CONFIG.get("DRIFT_MODE", "sample").lower() != "live" or not resource_id:
        return {
            "ok": True,
            "events": [
                {
                    "time": "2026-07-24T16:19:00Z",
                    "caller": "alex@example.com",
                    "operation": "Microsoft.Resources/subscriptions/resourcegroups/write",
                    "status": "Succeeded",
                }
            ],
        }
    days = int(CONFIG.get("AZURE_ACTIVITY_DAYS", "14") or "14")
    start = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=days)).isoformat()
    args = [
        "az", "monitor", "activity-log", "list",
        "--resource-id", resource_id,
        "--start-time", start,
        "--output", "json",
    ]
    subscription_id = CONFIG.get("AZURE_SUBSCRIPTION_ID", "")
    if subscription_id:
        args.extend(["--subscription", subscription_id])
    result = run_command(args, timeout=90)
    if not result["ok"]:
        return {"ok": False, "error": result["stderr"], "events": []}
    try:
        raw_events = json.loads(result["stdout"])
    except json.JSONDecodeError as exc:
        return {"ok": False, "error": f"Could not parse Azure Activity Log JSON: {exc}", "events": []}
    events = []
    for item in raw_events[:20]:
        events.append({
            "time": item.get("eventTimestamp") or item.get("submissionTimestamp"),
            "caller": item.get("caller", "unknown"),
            "operation": (item.get("operationName") or {}).get("value") or item.get("operationName", "unknown"),
            "status": (item.get("status") or {}).get("value") or item.get("status", "unknown"),
        })
    return {"ok": True, "events": events}


def correction_plan(payload: dict[str, Any]) -> dict[str, Any]:
    resource = payload.get("resource") or {}
    action = payload.get("action", "restore")
    address = resource.get("address", "<terraform-address>")
    diffs = resource.get("diffs", [])
    if action == "restore":
        commands = [
            f"terraform plan -refresh-only -target {address} -out drift-review.tfplan",
            "terraform show drift-review.tfplan",
            "# If review confirms Azure should be restored:",
            f"terraform plan -target {address} -out drift-fix.tfplan",
            "terraform apply drift-fix.tfplan",
        ]
        summary = "Restore Azure to Terraform desired state through a reviewed Terraform apply."
    elif action == "accept":
        changed = "\n".join([f"# {item.get('path')}: set Terraform desired value to Azure current value {item.get('current')}" for item in diffs[:10]])
        commands = [
            f"git checkout -b drift/{slugify(resource.get('name') or address)}",
            changed or "# Update Terraform configuration to match Azure current state.",
            "terraform fmt",
            "terraform plan",
            "# Open a PR with the plan output attached.",
        ]
        summary = "Accept the out-of-band Azure change by changing Terraform desired state."
    else:
        commands = [
            "# Add only for provider-managed or externally controlled properties.",
            "lifecycle {",
            "  ignore_changes = [",
            "    # add exact attributes here",
            "  ]",
            "}",
            "# Require owner, reason, and expiry date.",
        ]
        summary = "Suppress selected drift with an explicit time-boxed exception."
    return {"ok": True, "summary": summary, "commands": commands}


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-") or "resource"


class Handler(BaseHTTPRequestHandler):
    def log_message(self, format: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format % args))

    def send_json(self, payload: Any, status: int = 200) -> None:
        body = json.dumps(payload, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        if path == "/api/status":
            self.send_json({
                "mode": CONFIG.get("DRIFT_MODE", "sample"),
                "terraform": terraform_status(),
                "azure": azure_status(),
                "terraformWorkdir": CONFIG.get("TERRAFORM_WORKDIR", ""),
            })
            return
        if path == "/api/azure/subscriptions":
            self.send_json(azure_subscriptions())
            return
        if path == "/api/scan":
            self.send_json(scan())
            return
        if path == "/api/activity":
            params = urllib.parse.parse_qs(parsed.query)
            self.send_json(activity_for(params.get("resourceId", [""])[0]))
            return
        if path == "/":
            path = "/index.html"
        file_path = (STATIC / path.lstrip("/")).resolve()
        if not str(file_path).startswith(str(STATIC.resolve())) or not file_path.exists():
            self.send_error(404)
            return
        content_type = "text/html; charset=utf-8" if file_path.suffix == ".html" else "text/plain; charset=utf-8"
        if file_path.suffix == ".css":
            content_type = "text/css; charset=utf-8"
        if file_path.suffix == ".js":
            content_type = "application/javascript; charset=utf-8"
        body = file_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        length = int(self.headers.get("Content-Length", "0"))
        try:
            payload = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            self.send_json({"ok": False, "error": "Invalid JSON"}, 400)
            return
        if parsed.path == "/api/actions/plan":
            self.send_json(correction_plan(payload))
            return
        if parsed.path == "/api/azure/login":
            self.send_json(start_azure_login())
            return
        if parsed.path == "/api/azure/subscription":
            self.send_json(select_subscription(payload.get("subscriptionId", "")))
            return
        self.send_error(404)


def main() -> None:
    host = CONFIG.get("APP_HOST", "127.0.0.1")
    port = int(CONFIG.get("APP_PORT", "8765"))
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Terraform Drift Corrector running at http://{host}:{port}")
    print(f"Mode: {CONFIG.get('DRIFT_MODE', 'sample')}")
    server.serve_forever()


if __name__ == "__main__":
    main()
