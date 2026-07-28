# Terraform Drift Corrector

A local web app for reviewing and correcting Azure configuration drift on Terraform-managed resources.

The app can run in two modes:

- `sample`: uses built-in example drift data so you can explore the workflow immediately.
- `live`: runs Terraform and Azure CLI commands against your repo/subscription.

## Prerequisites for live mode

- Terraform CLI installed and on `PATH`
- Azure CLI installed and on `PATH`
- Logged in with Azure CLI: `az login`
- A Terraform repo with initialized backend access

## Configure

Copy `.env.example` to `.env` and edit the values:

```powershell
Copy-Item .env.example .env
```

Important settings:

- `DRIFT_MODE=live`
- `TERRAFORM_WORKDIR=C:\path\to\your\terraform\repo\environment`
- `AZURE_SUBSCRIPTION_ID=<subscription-id>`
- `TERRAFORM_WORKSPACE=<workspace-name>` if you use workspaces

You can also set the subscription from the app:

1. Start the app.
2. Click `Log into Azure`.
3. Complete the Azure CLI browser sign-in.
4. Click `Refresh subscriptions`.
5. Choose a subscription and click `Use subscription`.

The app saves the selected subscription to `.env`, runs `az account set --subscription <id>`, and passes the selected ID to Terraform as `ARM_SUBSCRIPTION_ID`.

## Run

```powershell
.\run.ps1
```

Then open:

```text
http://127.0.0.1:8765
```

## What live mode does

The scan endpoint runs:

```bash
terraform init -input=false
terraform workspace select <workspace>
terraform plan -refresh-only -out drift.tfplan
terraform show -json drift.tfplan
```

It parses Terraform resource changes, classifies drift, and enriches selected resources with Azure Activity Log events when possible. The drift table compares Terraform's recorded state with Azure's refreshed current state. A normal Terraform plan is still used before remediation so configuration remains the desired state.

The app does not run `terraform apply`. It generates reviewable correction steps so your normal Terraform pipeline remains the enforcement point.
