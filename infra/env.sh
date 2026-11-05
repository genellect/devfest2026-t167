# 共通の変数。使い方: source infra/env.sh
export PROJECT_ID="devfest2026-t167"
export REGION="asia-northeast1"          # Cloud Run・Firestore
export VERTEX_LOCATION="global"          # Gemini の Standard PayGo（依頼者承認済み）
export APPHOSTING_REGION="asia-east1"    # App Hosting（東京は非対応）
export DEV_REPO="genellect/devfest2026-t167"   # 作成した公開の開発用リポジトリの名前に合わせる（WIF はこのリポジトリだけを許可する）
export SUBMIT_REPO="Devfest-Hackathon-2026/df-2026-t167"
export GEMINI_MODEL="gemini-3.5-flash"  # 公式モデル情報で global の Standard PayGo を確認（2026-11-05）。実呼び出しは構築後に検証
