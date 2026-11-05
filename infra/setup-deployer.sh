#!/usr/bin/env bash
# GitHub Actions 用のデプロイ用サービスアカウントと WIF（鍵なし認証）を作る。開発用リポジトリから使える。
# 使い方: bash infra/setup-deployer.sh   （手順6で App Hosting のバックエンドを作った後に実行）
set -euo pipefail
source "$(dirname "$0")/env.sh"
P="$PROJECT_ID"
NUMBER=$(gcloud projects describe "$P" --format='value(projectNumber)')
SA="github-deployer@${P}.iam.gserviceaccount.com"
gcloud iam service-accounts describe "$SA" --project "$P" >/dev/null 2>&1 \
  || gcloud iam service-accounts create github-deployer --project "$P" --display-name="GitHub Actions deployer"
# 速度優先：権限の細かい調整で詰まらないよう編集者を付ける
# プロジェクト IAM 管理者：App Hosting へのデプロイ（firebase deploy --only apphosting）が、毎回
# App Hosting の実行用サービスアカウントのロールをプロジェクトの IAM に付け直すため（ないと 403 で止まる）。
# このアカウントは IAM を変えられるようになるので、ハッカソンの後に外す（docs/credentials.md の「抜けるとき・終わったとき」）
for ROLE in roles/editor roles/run.admin roles/firebaserules.admin roles/firebaseapphosting.admin roles/iam.serviceAccountUser \
            roles/resourcemanager.projectIamAdmin; do
  gcloud projects add-iam-policy-binding "$P" --member="serviceAccount:${SA}" --role="$ROLE" --condition=None >/dev/null
done
gcloud iam workload-identity-pools describe github --project "$P" --location=global >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools create github --project "$P" --location=global --display-name="GitHub Actions"
gcloud iam workload-identity-pools providers describe github-oidc --project "$P" --location=global --workload-identity-pool=github >/dev/null 2>&1 \
  || gcloud iam workload-identity-pools providers create-oidc github-oidc --project "$P" \
       --location=global --workload-identity-pool=github \
       --issuer-uri="https://token.actions.githubusercontent.com" \
       --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
       --attribute-condition="assertion.repository=='${DEV_REPO}'"
gcloud iam service-accounts add-iam-policy-binding "$SA" --project "$P" \
  --role="roles/iam.workloadIdentityUser" \
  --member="principalSet://iam.googleapis.com/projects/${NUMBER}/locations/global/workloadIdentityPools/github/attribute.repository/${DEV_REPO}" >/dev/null
echo "GitHub の Variables に登録してください:"
echo "  PROJECT_ID=${P}"
echo "  REGION=${REGION}"
echo "  VERTEX_LOCATION=${VERTEX_LOCATION}"
echo "  GEMINI_MODEL=${GEMINI_MODEL}"
echo "  WIF_PROVIDER=projects/${NUMBER}/locations/global/workloadIdentityPools/github/providers/github-oidc"
echo "  DEPLOYER_SA=${SA}"
echo "web/apphosting.yaml の API_ORIGIN: https://api-${NUMBER}.${REGION}.run.app"
