# 画面の変更を確かめる

PRの検査、PC・スマホでのプレビュー、本番反映の依頼は、[PRの確認から本番反映までの手順](../docs/contributor-preview-guide.md)に従います。

手元ではリポジトリのルートから `bash scripts/dev.sh setup`、`bash scripts/dev.sh serve` で起動し、参加コード `DEMO01` で試せます。開発用の鍵やトークンは不要です。終了は起動したターミナルで `Ctrl+C`。

プレビューは画面だけを変更し、API・データは本番と共有します。試験用の部屋と架空の文章で確認してください。

mainへのマージから自動デプロイまでを「本番反映」と呼びます。始める前にYuto Matsuiの承諾が必要です。詳しい準備とコマンドは[CONTRIBUTING](../CONTRIBUTING.md)にあります。
