#!/usr/bin/env bash
# Deploy to Cloud Run (two-container sidecar setup)
#
# Two-container setup:
#   nginx-container  — AI Studio proxy image, port 8080 (GEMINI_API_KEY via Secret Manager)
#   app-container    — Built Next.js image, port 3000 (Datadog APM + LLM Observability)
#
# API keys (GEMINI_API_KEY, DD_API_KEY) are injected at runtime from GCP Secret Manager.
#
# Usage:
#   bash deploy.sh
#
# Configuration (all variables can be set in .env — see .env.example):
#   GCP_PROJECT_ID   GCP project ID
#   GCP_REGION       GCP region (e.g. us-west1)
#   CR_SERVICE_NAME  Cloud Run service name
#   ARTIFACT_REPO    Artifact Registry repository name
#   APP_URL          Public URL override (auto-derived if not set)
#   APPLET_ID        AI Studio applet ID for the nginx proxy
#   DD_ENV           Datadog environment tag (default: prod)
#
# Prerequisites:
#   - Docker (with linux/amd64 support; Apple Silicon: docker buildx install)
#   - gcloud CLI authenticated: gcloud auth login
#   - Secrets GEMINI_API_KEY and DD_API_KEY in GCP Secret Manager
#   - Compute service account must have roles/secretmanager.secretAccessor on both secrets

set -euo pipefail

# ── Load .env first so all variables below can be overridden ───────────────────
if [ -f .env ]; then
  set -a && source .env && set +a
fi

# ── Configuration (env vars take precedence; hardcoded values are fallbacks) ───
PROJECT_ID="${GCP_PROJECT_ID:?GCP_PROJECT_ID must be set in .env}"
REGION="${GCP_REGION:-us-west1}"
SERVICE_NAME="${CR_SERVICE_NAME:-datadog-presales-practice-simulator}"
ARTIFACT_REPO="${ARTIFACT_REPO:-cloud-run-source-deploy}"

IMAGE="$REGION-docker.pkg.dev/$PROJECT_ID/$ARTIFACT_REPO/$SERVICE_NAME"

APPLET_ID="${APPLET_ID:?APPLET_ID must be set in .env — create an AI Studio applet at https://aistudio.google.com}"
DD_ENV="${DD_ENV:-prod}"

# Derive the numeric project number (needed for service.yaml namespace and default APP_URL).
# This calls the GCP API once and caches the result for the rest of the script.
PROJECT_NUMBER=$(gcloud projects list \
  --filter="projectId:${PROJECT_ID}" \
  --format="value(PROJECT_NUMBER)" 2>/dev/null)
if [ -z "$PROJECT_NUMBER" ]; then
  echo "ERROR: Could not resolve project number for project '$PROJECT_ID'. Ensure gcloud is authenticated and the project exists."
  exit 1
fi

APP_URL="${APP_URL:-https://${SERVICE_NAME}-${PROJECT_NUMBER}.${REGION}.run.app}"

# ── Git metadata for Datadog Source Code Integration ──────────────────────────
SHORT_SHA=$(git rev-parse --short HEAD)
FULL_SHA=$(git rev-parse HEAD)
GIT_REPO_URL=$(git config --get remote.origin.url)
BUILD_TAG="${SHORT_SHA}-$(date +%s)"

# ── Helpers ───────────────────────────────────────────────────────────────────
step() { echo ""; echo ">>> $1"; }

# ── Print resolved config ─────────────────────────────────────────────────────
echo "============================================"
echo "Deploying: $SERVICE_NAME"
echo "Project:   $PROJECT_ID"
echo "Region:    $REGION"
echo "Image:     $IMAGE:$BUILD_TAG"
echo "DD_ENV:    $DD_ENV"
echo "APP_URL:   $APP_URL"
echo "============================================"

# ── Steps ─────────────────────────────────────────────────────────────────────

step "Setting gcloud project: $PROJECT_ID"
gcloud config set project "$PROJECT_ID"

step "Enabling required GCP APIs"
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  --project="$PROJECT_ID"

step "Ensuring Artifact Registry repository exists: $ARTIFACT_REPO"
gcloud artifacts repositories create "$ARTIFACT_REPO" \
  --repository-format=docker \
  --location="$REGION" \
  --description="Cloud Run deployments" \
  --project="$PROJECT_ID" 2>/dev/null || echo "  Repository already exists, continuing."

step "Configuring Docker authentication for Artifact Registry"
gcloud auth configure-docker "$REGION-docker.pkg.dev" --quiet

step "Building Docker image (linux/amd64) — build tag: $BUILD_TAG"
docker build \
  --platform linux/amd64 \
  --build-arg DD_VERSION="$SHORT_SHA" \
  -t "$IMAGE:latest" \
  -t "$IMAGE:$BUILD_TAG" \
  .

step "Pushing image to Artifact Registry"
docker push "$IMAGE:latest"
docker push "$IMAGE:$BUILD_TAG"

step "Rendering service.yaml with actual image, SHA, and URLs"
TMP_YAML="/tmp/cloudrun-service-$$.yaml"
sed \
  -e "s|__APP_IMAGE__|$IMAGE:$BUILD_TAG|g" \
  -e "s|__SHORT_SHA__|$SHORT_SHA|g" \
  -e "s|__FULL_SHA__|$FULL_SHA|g" \
  -e "s|__GIT_REPO_URL__|$GIT_REPO_URL|g" \
  -e "s|__DD_ENV__|$DD_ENV|g" \
  -e "s|__APPLET_ID__|$APPLET_ID|g" \
  -e "s|__APP_URL__|$APP_URL|g" \
  -e "s|__GCP_PROJECT_NUMBER__|$PROJECT_NUMBER|g" \
  service.yaml > "$TMP_YAML"

echo "  Rendered YAML written to: $TMP_YAML"

step "Deploying two-container service via: gcloud run services replace"
# 'services replace' is required for multi-container (sidecar) deployments;
# 'gcloud run deploy' only supports a single container.
gcloud run services replace "$TMP_YAML" \
  --region "$REGION" \
  --project "$PROJECT_ID"

rm -f "$TMP_YAML"

echo ""
echo "============================================"
echo "Deployment complete!"
echo "Service URL:    $APP_URL"
echo "Image tag:      $BUILD_TAG"
echo "DD_VERSION:     $SHORT_SHA"
echo "Project number: $PROJECT_NUMBER"
echo "============================================"
