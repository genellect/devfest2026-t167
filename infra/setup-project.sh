#!/usr/bin/env bash
# 1つのプロジェクトに API・Firestore・Artifact Registry・API 実行用サービスアカウントを作る。
# 使い方: bash infra/setup-project.sh   （同じプロジェクトに2回実行しても壊れない）
set -euo pipefail
source "$(dirname "$0")/env.sh"
P="${1:-$PROJECT_ID}"

gcloud services enable --project "$P" \
  run.googleapis.com artifactregistry.googleapis.com cloudbuild.googleapis.com \
  firestore.googleapis.com firebase.googleapis.com firebaserules.googleapis.com \
  firebaseapphosting.googleapis.com identitytoolkit.googleapis.com \
  aiplatform.googleapis.com iam.googleapis.com iamcredentials.googleapis.com \
  sts.googleapis.com cloudresourcemanager.googleapis.com

gcloud firestore databases describe --project "$P" >/dev/null 2>&1 \
  || gcloud firestore databases create --project "$P" --location="$REGION"
gcloud artifacts repositories describe app --project "$P" --location="$REGION" >/dev/null 2>&1 \
  || gcloud artifacts repositories create app --project "$P" --location="$REGION" --repository-format=docker

SA="api-runtime@${P}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA" --project "$P" >/dev/null 2>&1 \
  || gcloud iam service-accounts create api-runtime --project "$P" --display-name="Cloud Run API runtime"
# IDトークンの失効・無効化確認はユーザー情報の読み取りが必要。権限の付与・変更はAPIに許可しない。
for ROLE in roles/datastore.user roles/aiplatform.user roles/logging.logWriter roles/firebaseauth.viewer; do
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:${SA}" --role="$ROLE" --condition=None >/dev/null
done
echo "OK: $P の基盤を作成しました"
