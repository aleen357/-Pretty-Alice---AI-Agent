# Pretty Alice Deployment Guide

This project uses **Infrastructure-as-Code (IaC)** and **CI/CD** to automate cloud deployment.

## 1. Infrastructure (Terraform)
The `terraform/` directory contains the code to provision:
- Cloud Run Service
- Artifact Registry Repository
- Required Google Cloud APIs (Cloud Run, Firestore, IAM)

To deploy the infrastructure:
1. Install Terraform.
2. Run `terraform init`.
3. Run `terraform apply`.

## 2. Automated Deployment (GitHub Actions)
The `.github/workflows/deploy.yml` file automates the following on every push to `main`:
1. **Builds** the Docker image.
2. **Pushes** the image to Google Artifact Registry.
3. **Deploys** the new version to Google Cloud Run.

### Setup Requirements:
- Add `GCP_SA_KEY` (Service Account JSON) to your GitHub Repository Secrets.
- Add `GEMINI_API_KEY` to your GitHub Repository Secrets.
