# Development Status

最終更新: 2026-08-09（Asia/Tokyo）

この文書は「現在どこまで開発できているか」と「次に何をするか」を記録する。恒久的な仕様、設計方針、DB互換性、安全ルール、デプロイ手順の詳細はルートの [`AGENTS.md`](../AGENTS.md) を参照する。

## 1. 現在の開発状況

### 全体

- 認証が必要なモバイル向け試用版として、本番環境で利用できる段階。
- Supabase認証、プロフィール、体重・体脂肪率、ファスティング計画、体調・食事時刻、グラフ、ひろば、設定、フィードバック、管理者画面までコード上は実装済み。
- 本番URLは `https://fasting-diet.vercel.app`。2026-08-09にNext.js版への本番切替を完了し、ログイン、既存データ読込、主要画面、ページ遷移、再読込を確認済み。
- 現在は試用版であり、実際の決済と外部AIは未接続。アプリ全体が正式商用版として完成した状態ではない。

### 現在動作している主要機能

- メール認証、登録、ログイン、ログアウト、パスワード再設定。
- プロフィール初期登録・編集、BMI表示、目標体重の安全下限、18歳未満／BMI 18.5未満のファスティング利用制限。
- 体重・体脂肪率の保存、編集、削除、メモ、最新値同期、履歴と期間別グラフ。
- ファスティング計画（3/5/7日およびカスタム）、安全確認、準備・本番・回復フェーズ、ガイド表示。
- 日々の体調記録（水分、睡眠、空腹感、体調、お通じ、むくみ、不調、メモ等）。
- 1日に複数の食事時刻を保存し、直近の食事間隔を自動計算。最後の食事から16時間後を参考時刻として表示。
- ひろばの投稿、いいね、通報、自分の投稿削除、管理者モデレーション。
- 不具合・意見の送信、管理者確認。
- JSONバックアップ、アカウント完全削除、利用規約、プライバシーポリシー。

「動作している」は、コードに実装があり、直近のVercel本番ビルドが成功したことを基準にしている。すべての機能を2026-08-08に再度E2E確認したわけではないため、要確認項目は後述する。

## 2. 直近で実装・修正した内容

### 複数食事時刻と自動計算

- 変更理由: 「食べていない時間」を利用者が手計算して入力する方式ではなく、複数の食事時刻からアプリ側で計算できるようにするため。
- `src/app/fasting/page.tsx`
  - 「＋ 時間を追加」で同日に複数の時刻入力欄を追加。
  - 各時刻を削除可能。
  - 同日に2件以上あれば最新2件の差を計算。
  - 当日1件だけなら、直近の過去記録の最後の食事との間隔を計算。
  - 最後の食事から16時間後を「次の目安」として表示。
  - 16時間を必達目標にせず、体調を優先する注意文を表示。
  - 履歴に複数時刻と計算済み時間を表示。
- `supabase/daily_conditions_meal_times.sql`
  - `eating_time time`、`meal_times text[]`、`fasting_hours numeric(5,1)` を追加。
  - `fasting_hours` は0〜168時間に制限。
- `supabase/README.md`
  - 食事時刻マイグレーションを現行SQL適用順へ追加。
- 本番Supabaseへの `meal_times` 列追加は、ユーザーがSQL Editorで実行し `Success. No rows returned` を確認済み。
- 本番画面で、例として16:05入力時に「翌日08:05」が表示されることをユーザー実機で確認済み。

### 体調表示の明確化

- 変更理由: 選択値や履歴が何を示すか分かりにくかったため。
- `src/app/fasting/page.tsx`
  - 入力欄および履歴に「体調」「お通じ」ラベルを明示。

### 体重保存後の誤った未保存警告

- 変更理由: 体重を正常保存した直後にも、画面遷移時に未保存警告が出ることがあったため。
- `src/app/record/page.tsx`
  - DB再読込で保存済み行の実IDとフォームスナップショットが揃うまで `saving=true` を維持。
  - 一時的なフォーム差分を未保存変更と誤判定しないよう修正。

### 開発引き継ぎ情報

- `AGENTS.md`
  - 2026-08-08に新規作成。
  - 恒久仕様、設計、安全ルール、新旧DB互換、Supabase/Vercel運用を整理。
- `docs/DEVELOPMENT_STATUS.md`
  - 本文書。現在地点と次作業を分離して管理するため新規作成。

## 3. 現在のGit・本番運用状態

- 正規Gitリポジトリは `C:\Users\lj\Projects\fasting-tracker`。GitHub originは `https://github.com/infomarunakashouten-coder/fasting-app.git`。
- PR #1で `migration/nextjs-current` を `master` へmerge済み。merge commitは `ad0cf7f22bf9b9d3037415e84e3be2ffffd6cbf0`。
- `master`を本番ブランチとし、通常開発では最新の `master` から作業ブランチを作成する。`master`へ直接変更・commit・pushしない。
- Vercelプロジェクト `diet`（Project ID `prj_enUb2rxc8qDEP6hTRJG3xH5M53VM`）はGitHubと接続済みで、Production Branchは `master`。
- `fasting-diet.vercel.app` はProject Settings → DomainsにProduction Domainとして正式登録済み。Auto-assign Custom Production DomainsはEnabled。
- 現行Next.js Production Deploymentは `dpl_5MRQAFFaCjhsDRjUqzY1BwVJewrE`（Ready）。`fasting-diet.vercel.app` はこのDeploymentを指している。
- 直前のProduction Deployment `dpl_3FnN8DwLU5n351xfSpxaJpzBMR3X` はReadyのまま、ロールバック用として削除せず保持する。
- 旧HTML版の `index.html` / `fasting-app.html` は削除せず残している。現在のNext.jsデプロイを妨げていないため、削除する場合は別PRで扱う。
- 開発環境だけCSP `script-src` に `'unsafe-eval'` を許可し、Next.js React Fast Refreshを動作させた。本番CSPは従来どおり `'unsafe-eval'` を含まない。
- 新しい作業場所で `npm ci`、TypeScript型チェック、本番buildが成功。localhostで既存アカウントの認証、既存プロフィール・体重・体脂肪率・グラフ・計画・食事時刻、下部ナビを確認済み。
- 一時コミュニティ投稿1件でINSERT、画面反映、再読込後の永続化、DELETE、削除後の再読込を確認済み。テストデータは残っておらず、既存投稿も維持されている。
- PR Previewと新Productionの両方で認証・読み取り中心の主要画面確認を実施し、本番切替後も重大なブラウザコンソールエラーがないことを確認済み。

## 4. 未完了タスク

### High

- **正式公開前の決済・法務対応**
  - Stripe等の実決済、Webhook、購読状態同期、返金／解約フローは未実装。
  - 特定商取引法表記、運営者情報、問い合わせ先、返金・障害方針が未整備。
- **本番データ保護の継続確認**
  - Supabase RLS、管理者RPC、完全削除RPCが本番で期待どおり動くか、リリース前に別ユーザーを使って再確認する。

### Medium

- **食事間隔機能の追加検証**
  - 同日に3件以上入力した場合。
  - 前日最後の食事から当日最初の食事まで。
  - 入力順が時系列順でない場合（コードは計算前にソート）。
  - 同時刻の重複、時刻削除、保存後再読込、日付境界。
  - 直近5件に前回食事が存在しない場合の表示。
- **自動テスト導入**
  - 食事間隔、16時間後、BMI、フェーズ、体重互換保存、未保存警告のユニット／E2Eテストがない。
- **依存関係の監査**
  - 2026-08-04のVercel `npm install` で high severity 5件が報告された。`npm audit` の内容を確認し、強制アップグレードせず互換性を評価する。
- **外部AI機能**
  - AIタブと写真チェックはプレビュー／将来用UI。外部AIへの接続、データ送信同意、利用規約・プライバシー記載が未実装。

### Low

- `src/app/fasting/page.tsx` と `src/app/settings/page.tsx` の責務分割。ただし動作変更を伴う大規模リファクタは、テスト整備後に行う。
- 食事履歴を直近5件ではなく専用クエリまたは食事イベントテーブルで扱い、長期間空いた場合も正確に前回時刻を取得する。
- 静的コラム、Q&A、用語集の運用方法をコード外へ移すか検討する。

## 5. 要確認事項

### 実機・ブラウザ

- iPhone/Safariで「＋ 時間を追加」、複数時刻、削除、保存、再読込を一巡する。
- 23時台の食事から翌日の目安が正しい日付・時刻になること。
- 翌日に最初の食事を入力した時、前日の最後の食事からの時間が正しく表示されること。
- 固定下部ナビと「不具合報告」ボタンが、食事時刻欄や保存ボタンを隠さないこと。
- 体重保存直後にホーム／設定へ移動しても未保存警告が出ないこと。実際に入力を変更して未保存なら警告が出ること。
- 欠測した体重・体脂肪率が0としてグラフに描画されないこと。

### Supabase

- `daily_conditions.meal_times` が複数値を保持し、再読込で同じ順序・内容が復元されること。
- `fasting_hours` が期待値の小数1桁で保存されること。
- 別ユーザーから健康データを読めないこと。
- バックアップJSONに新しい `daily_conditions` 列が含まれること。

### ユーザー確認が必要な仕様

- 16時間後は医学的な推奨や通知ではなく、最後の食事から計算した参考時刻という現仕様でよいか。
- 食事時刻に、カロリーのある飲み物や間食を含めるか。現UIには判定ルールを細かく定義していない。
- 過去日の食事時刻を編集する導線が必要か。現画面は基本的に当日の体調記録を扱う。

## 6. 既知の問題・注意点

- Next.js本番移行は完了済み。今後は作業ブランチ、PR、Preview確認、`master`へのmerge、Production確認の手順を維持する。
- 食事間隔は `conditionHistory` の直近5件だけを参照する。前回の食事記録が範囲外なら自動計算できない。
- 同日に複数時刻がある場合は、最新2件の差だけを「前回の食事から」として表示・保存する。1日の最長断食や平均ではない。
- AIタブはルールベースのプレビューで、生成AIによる判定ではない。
- 課金が無効な試用環境では `hasPremiumAccess` が広く真になる。表示上の有料状態と実決済状態を混同しない。
- 体重とプロフィールには新旧スキーマ互換処理がある。`daily_records`/`weight_records`、`profiles.id`/`profiles.user_id` 等を整理する場合はデータ移行が必要。詳細は `AGENTS.md`。
- 以前のローカル `next build` ではテンプレート変数置換エラーがあったが、2026-08-08に新しい作業場所で再実行し成功した。
- `fasting-diet.vercel.app` はProduction Domainとして登録済みで、`master`へのmerge後に新Productionへ自動切替される。通常運用では `vercel alias set` を使わず、`inspect`で自動切替結果を確認する。
- Vercel/Supabaseの認証情報やユーザーの健康データをログや文書へ記録しない。

## 7. 次のセッションで最初にやること

1. ルートの `AGENTS.md` と本ファイルを読む。
2. `git status` と現在ブランチを確認する。作業開始前に `master` を `origin/master` へfast-forward同期する。
3. 最新の `master` から目的別の作業ブランチを作成し、`master`へ直接変更・commit・pushしない。
4. 実装後にTypeScriptチェック、本番build、必要なローカル動作確認を行い、作業ブランチをpushしてPRを作成する。
5. Vercel PreviewがReadyになったことを確認し、認証、主要画面、既存データ読込、ブラウザエラーを確認してからPRをmergeする。
6. merge後のProduction DeploymentがReadyになるまで確認し、Deployment URLで検証後、`fasting-diet.vercel.app` の向き先を `inspect` する。
7. 異常時に戻せるよう、直前の正常なProduction Deploymentを削除せず保持する。

## 8. 最終確認状況

| 項目 | 状況 | 最終確認・補足 |
|---|---|---|
| Type check | 実行済み・成功 | 2026-08-08、Git移行先とCSP修正後に `npx.cmd tsc --noEmit` が終了コード0。 |
| Local build | 実行済み・成功 | 2026-08-08、Git移行先とCSP修正後に `npm.cmd run build` が成功し、26ページを生成。 |
| Vercel production build | 実行済み・成功 | 2026-08-09、Next.js deployment `dpl_5MRQAFFaCjhsDRjUqzY1BwVJewrE`、status Ready。PR #3のmerge commit `8931086fa42d8aa90bdde7bd9072d1ba3a2ae42b` を使用。 |
| Lint | 未実行 | `npm run lint` スクリプトは存在するが、このセッションでは実行記録なし。 |
| Automated tests | 未実行／基盤なし | package scriptsにtestなし。ユニット・E2Eテスト設定も確認できない。 |
| Supabase migration | 実行済み | 食事時刻関連列はユーザーがSQL Editorで実行し成功画面を提示。 |
| Production deploy | 実行済み・成功 | 2026-08-09、PR #3の`master` merge後にProduction `dpl_5MRQAFFaCjhsDRjUqzY1BwVJewrE`を作成しReadyを確認。 |
| Production domain | 登録済み・確認済み | `fasting-diet.vercel.app` をProject `diet`のProduction Domainとして登録。Auto-assign Enabled。`vercel inspect` で `dpl_5MRQAFFaCjhsDRjUqzY1BwVJewrE` を取得。 |
| Production smoke check | 実行済み・成功 | 本番URLでログイン、ホーム、プロフィール、体重・履歴・グラフ、ファスティング、ひろば、設定、下部ナビ、再読込、既存データ読込を確認。重大なコンソールエラーなし。 |
| Rollback | 準備済み | 直前のProduction `dpl_3FnN8DwLU5n351xfSpxaJpzBMR3X` はReadyのまま削除せず保持。 |
| Local auth/read smoke check | 実行済み・成功 | localhostで既存アカウントへログインし、ホーム、プロフィール、体重・体脂肪率、グラフ、計画、食事時刻、下部ナビを確認。 |
| Local write smoke check | 実行済み・成功 | 識別可能な一時コミュニティ投稿1件のINSERT、再読込、DELETE、削除後再読込を確認。テストデータ残存なし。 |

## 更新時の扱い

- 完了した短期タスクは「直近の変更」へ必要最小限だけ残し、古い履歴を蓄積し続けない。
- 現在地点、未完了タスク、検証結果、次の手順が変わったら本ファイルを更新する。
- 恒久的な仕様や開発ルールが変わる場合は、本ファイルではなく `AGENTS.md` も更新する。
