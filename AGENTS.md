# AGENTS.md — fasting-tracker 開発引き継ぎ

このファイルは、過去の会話を参照できない新しい Codex セッションが、安全に開発を継続するためのプロジェクト固有情報である。コードと本番運用で確認できた事実を優先している。仕様を変更した場合は、このファイルも同じ作業内で更新すること。

## 1. アプリの目的と現状

- 日本語のモバイル向け「ファスティング倶楽部」。体重・体脂肪率、プロフィール、ファスティング計画、日々の体調と食事時刻を記録し、本人が振り返るためのアプリ。
- 医療上の診断・治療・栄養指導を行うものではない。安全確認、BMI・年齢制限、体調悪化時の中止案内を重要な製品仕様として扱う。
- 現在は試用版。課金 UI はあるが、実決済・返金・解約処理は未接続。`NEXT_PUBLIC_BILLING_ENABLED` が `true` でない限り、試用のためプレミアム機能を広く利用できる。
- 本番利用 URL は `https://fasting-diet.vercel.app`。
- UI はスマートフォン幅を主対象とし、主要画面は `max-w-[430px]` の1カラム構成。

## 2. 技術スタック

- Next.js 15.5.19、App Router、TypeScript、React 18。
- Tailwind CSS 3.4 系、PostCSS 8.5.15。
- Supabase Auth / Postgres / RLS。ブラウザ用 `@supabase/supabase-js` と SSR 用 `@supabase/ssr` を使用。
- Recharts 2.12.7（体重・体脂肪率グラフ、レポート）。
- Vercel にデプロイ。インストールは `npm install`、ビルドは `npm run build`、出力は `.next`。
- 必須環境変数：`NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`。課金切替：`NEXT_PUBLIC_BILLING_ENABLED`。
- 自動テスト基盤は現時点で存在しない。最低限 `npx.cmd tsc --noEmit` と本番相当の `npm.cmd run build` を行う。

## 3. 重要なフォルダ／ファイル

- `src/app/`：App Router のページ。
  - `dashboard/page.tsx`：ホーム、現在値、今日の入力、14日推移、現在のファスティング段階。
  - `record/page.tsx`：体重・体脂肪率の入力、編集、削除、履歴、期間別グラフ。
  - `fasting/page.tsx`：計画、ガイド、体調記録、食事時刻、AIプレビュー。大きな単一ファイルなので変更範囲を限定すること。
  - `community/page.tsx`：投稿、コラム、Q&A、用語集。
  - `settings/page.tsx`：プロフィール、プラン、バックアップ、退会、管理者導線、セキュリティ準備状況。
  - `graph/page.tsx`、`report/page.tsx`：詳細グラフと月次レポート。
  - `premium/page.tsx`：プラン説明と試用版／課金状態表示。
  - `feedback/page.tsx`：不具合・意見送信と本人の送信履歴。
  - `admin/community/page.tsx`、`admin/feedback/page.tsx`：`profiles.is_admin` が真の管理者専用画面。
  - `auth/`：登録、ログイン、パスワード再設定、コールバック。
  - `profile/setup`、`profile/edit`：初期登録と編集。
  - `monitor`、`terms`、`privacy`：公開可能な案内・法務ページ。
- `src/components/Navigation.tsx`：固定下部ナビ（ホーム、体重、ファスティング、ひろば、設定）と「不具合報告」フローティング導線。
- `src/middleware.ts`：Supabase セッション更新、未ログイン時の保護、認証済みユーザーの認証ページからのリダイレクト、非公開ページの no-store ヘッダー。
- `src/lib/weight-records.ts`：新旧体重テーブルへの互換保存。破壊しないこと。
- `src/lib/merge-weight-records.ts`：同日の新旧記録統合。両方ある場合は `daily_records` が優先。
- `src/lib/records-chart.ts`：7/14/30/90/365日のチャート期間、日次データ、目盛り・日付表示。
- `src/lib/fasting-eligibility.ts`：年齢・BMI安全判定。
- `src/lib/profile-validation.ts`：プロフィール入力範囲と目標BMI制約。
- `src/lib/fasting-plan.ts`：キャンセル済み計画を除外して最新計画を選ぶ。
- `src/lib/use-unsaved-changes.ts`：ページ離脱時の未保存警告。
- `src/lib/billing.ts`：試用／課金モードとプレミアム判定。
- `supabase/`：DBスキーマ、追加マイグレーション、RLS、RPC。`supabase/README.md` の適用順を必ず確認する。
- `RELEASE_READINESS.md`：試用開始・正式課金公開までのチェックリスト。
- `.vercel/project.json`、`vercel.json`：Vercel接続とビルド設定。

## 4. 認証・公開範囲

- Supabase Auth のメール認証を使用。
- 常時公開：`/auth/callback`、`/auth/reset-password`、`/monitor`、`/terms`、`/privacy`、manifest、アイコン。
- ログイン／登録／パスワード忘れページは未ログイン時のみ。その他は原則ログイン必須。
- 認証後ページには `private, no-store` を付与している。健康情報を共有キャッシュさせない。
- CSP、HSTS、X-Frame-Options、Permissions-Policy 等は `next.config.js` で全ページに設定。

## 5. 現在実装済みの機能

### プロフィール

- ニックネーム、生年月日／年齢、性別、身長、現在・開始・目標体重、体脂肪率、筋肉量、ウエスト、生理周期、睡眠、通知、アバター。
- 初期登録は3ステップ。編集画面あり。
- BMI表示、安全な目標体重下限の提示。

### 体重・体脂肪率

- 日付ごとの保存、同日編集、削除、メモ。
- 体重または体脂肪率だけでも保存可能。未入力値を `0` として扱わない。
- 14/30/90/365日のグラフ、詳細グラフ、月次レポート。
- 最新値をプロフィールにも同期。削除時は残っている最新記録から再計算。

### ファスティング計画

- 3日、5日、7日プリセットとカスタム日数。
- 準備期・本番期・回復期、開始日、主な飲み物、メモ、安全確認を保存。
- 計画リセット／置換時も履歴行を消さず、状態で非表示にする。
- 計画、フェーズ別ガイド、準備食例、回復食、体調別の中止目安を表示。

### 体調・食事時刻

- 水分、睡眠、空腹感1〜5、体調、お通じ、むくみ、不調、食事・飲み物、メモ。
- 1日に複数の「食べた時間」を追加・削除して保存。
- 前回の食事からの経過時間を自動計算し、16時間後の次の食事目安を表示。
- 直近5件の体調履歴を表示。
- AIタブは現時点では入力値に基づくルールベースのプレビュー。外部AIや写真解析は未接続。

### ひろば・運用

- カテゴリ別投稿、匿名設定、いいね、通報、自分の投稿削除。
- コラム、Q&A、用語集はコード内静的コンテンツ。
- 管理者による投稿確認・モデレーションと不具合報告管理。
- JSONバックアップ、アカウント完全削除RPC。
- 利用規約、プライバシーポリシー、モニター案内。

## 6. 重要な計算・安全仕様

### BMI・利用資格

- BMI = `体重kg / (身長m)^2`。
- 本格ファスティング機能は18歳以上かつBMI 18.5以上。生年月日があれば現在日付から年齢を計算し、なければ保存済み年齢を使う。
- 身長または現在体重がない場合も本格機能を許可しない。
- 目標体重は BMI 18.5 を下回らない値。下限は `ceil(18.5 * 身長m^2 * 10) / 10` kg。
- 医療的な断定や16時間断食の達成を強制する表現を入れない。体調悪化時は食事・中止・必要に応じた医療相談を優先する。

### プロフィール入力範囲

- 身長80〜250cm、現在・開始・目標体重20〜500kg、体脂肪率0〜100%、筋肉量0〜200kg、ウエスト30〜250cm、睡眠0〜24時間、生理周期1〜120日の整数。未来の生年月日と120歳超相当を拒否。

### 計画日数・フェーズ

- プリセット：3日=`1/1/1`、5日=`1/2/2`、7日=`2/2/3`（準備/本番/回復）。
- カスタムは各フェーズ1〜30日、合計3〜60日。開始日を1日目とし、経過日数でフェーズと進捗率を計算。
- `canceled`、`cancelled`、`deleted`、`inactive` の計画は最新計画候補から除外。

### 食事時刻と断食時間

- `meal_times` は当日のローカル時刻文字列配列（`HH:mm`）。表示・計算前に昇順ソート。
- 当日に2件以上あれば、最新2件の差を「前回の食事から」の時間とする。
- 当日1件だけなら、直近5件の体調履歴から今日より前の最新記録を探し、その日の最後の食事から今日の食事までを計算する。
- `fasting_hours` は上記結果を小数1桁に丸めて保存。DB制約は0〜168時間。
- `eating_time` には当日の最後の食事時刻も保存し、旧データとの互換性を維持。
- 16時間後の表示は最後の食事時刻 + 16時間の「目安」。医療推奨や必達目標として扱わない。
- 現仕様は直近5件しか読み込まないため、5件以内に前回の食事がない場合は間隔を算出できない。

### 体重記録

- 1ユーザー・1日1行が前提。
- 新規追加時に片方の値だけ入力した場合、同日の既存のもう片方を保持する。明示的な編集では空欄保存によりその項目を削除できる。
- グラフは欠測値を `null` のまま扱い、0に変換しない。
- 保存成功後、DB再読込で実IDをフォームと保存済みスナップショットへ反映し終えるまで `saving=true` を保つ。これにより保存直後の誤った未保存警告を防ぐ。

## 7. データ保存と互換性

- すべての健康・プロフィールデータは Supabase Postgres。ローカルストレージはアバター補助、生年月日互換、ダウングレード予約など限定用途。
- RLSを前提とし、健康データは `auth.uid()` と一致する本人のみ操作可能。管理処理は管理者RPC／制限されたポリシーを使う。
- 主要テーブル：
  - `profiles`：プロフィール、プラン、AI枠、購読状態、管理者フラグ等。
  - `daily_records`：現行の体重・体脂肪率・メモ。
  - `weight_records`：旧体重テーブル。互換性のため現在も読み書きする。
  - `daily_conditions`：体調と食事時刻。`user_id, recorded_date` の一意性を前提。
  - `fasting_plans`：計画、安全同意、フェーズ日数、状態。
  - `fasting_records`、`fasting_logs`：旧／補助的なファスティング記録。
  - `community_posts`、`community_post_likes`、`community_post_reports`：ひろば。
  - `app_feedback`：不具合・意見。
  - `diagnosis_results`、`meal_checks`：診断・将来用AIチェック。
- `daily_conditions` の主要列：`water_ml`, `sleep_hours`, `hunger_level`, `condition`, `bowel_movement`, `swelling`, `discomfort`, `meal_log`, `memo`, `eating_time`, `meal_times text[]`, `fasting_hours`。
- `profiles` には新旧スキーマが存在し得る。多くの画面が主キー `id=user.id` と旧 `user_id=user.id` の両方を読み、欠損をマージする。体重も `current_weight_kg` と旧 `current_weight` の両方を扱う。この互換処理を安易に削除しない。
- 体重は `daily_records` と旧 `weight_records` の両方へ保存し、どちらか一方が成功すればユーザー操作は成功扱い。移行を完了するまでは二重保存を維持する。
- DB型の完全な単一ソースはまだない。`supabase/schema.sql` だけでは本番の全テーブルを表現しておらず、追加SQLも確認すること。

## 8. UI/UXルール

- 日本語、やさしく断定しすぎない文体。健康不安を煽らず、安全上必要な注意は省略しない。
- ベース色は淡いベージュ、主要色はティール（例 `#5d9997` / `#4d8b8a`）、カードは白、角丸を大きくする既存デザインを維持。
- モバイルでタップしやすい高さ、固定下部ナビと `pb-24` 等の余白を確保。iPhoneのセーフエリアを壊さない。
- 未入力・欠測は `--` または未記録として表示し、0と混同しない。
- 保存中はボタンを無効化し、成功・エラーをユーザー向け日本語で表示。
- フォームの初期値または読込済み値を保存済みスナップショットとして保持し、本当に変更がある時だけ離脱警告を出す。
- ファスティング体調欄の「体調」「お通じ」ラベルと履歴ラベルを維持。
- 食事時刻は手動の「食べていない時間」入力へ戻さず、複数時刻から自動計算する。
- `Navigation` の固定ナビと不具合報告ボタンが入力欄・保存ボタンを隠さないか、実機幅で確認する。

## 9. これまでの重要な不具合修正

- 体重保存直後に未保存警告が出る問題：保存途中で `saving=false` にしていたため、DB再読込前の一時的なID／フォーム差分を未保存と判定していた。再読込完了後に `saving=false` とするよう修正済み。
- 体重・プロフィールの新旧DB差異：`daily_records`/`weight_records`、`profiles.id`/`profiles.user_id`、`current_weight_kg`/`current_weight` を互換読込・保存するよう修正済み。
- 欠測値が0としてグラフや表示に混ざる問題：数値化時に `null` を維持し、記録がある系列だけを描画する。
- 体調履歴の意味が分かりにくい問題：「体調」「お通じ」ラベルを明示。
- 食事間隔を手入力していた問題：複数の食事時刻から直近の間隔を自動計算し、16時間後を参考時刻として表示する仕様へ変更。
- `daily_conditions.bowel_movement` のDB制約と日本語選択肢の不一致：`なし` / `あり` を許可するマイグレーションあり。
- Vercelの利用URLが自動更新されなかった問題：`fasting-diet.vercel.app` を特定Deploymentへの手動aliasとしてだけ設定し、Project Settings → Domainsへ登録していなかったことが原因。現在はProduction Domainとして正式登録済みで、自動切替を使用する。

## 10. 現在の作業状態

- 2026-08-04時点で、複数食事時刻の保存、自動間隔計算、16時間後の目安、安全注意文まで実装・本番反映済み。
- 対応DB列 `daily_conditions.meal_times text[]`、`eating_time`、`fasting_hours` は本番Supabaseへ適用済みとユーザー画面で確認済み。
- 2026-08-08、正規Gitリポジトリを `C:\Users\lj\Projects\fasting-tracker` へcloneし、Next.js版を `migration/nextjs-current` ブランチへ移行した。旧 `index.html` / `fasting-app.html` は履歴と比較用に残している。
- Next.js開発モードのReact Fast RefreshがCSPで拒否されていたため、`process.env.NODE_ENV === "development"` の場合だけ `script-src` に `'unsafe-eval'` を追加した。本番CSPには含めない。
- 新しい作業場所で `npm ci`、`npx.cmd tsc --noEmit`、`npm.cmd run build` が成功。ローカル認証、既存プロフィール・体重・グラフ・計画・食事時刻の読込、下部ナビを確認済み。
- 本番Supabaseに対し、識別可能な一時コミュニティ投稿1件のINSERT、再読込、DELETEを確認し、テストデータが残っていないことと既存投稿が維持されていることを確認済み。
- 2026-08-09、PR #1で `migration/nextjs-current` を `master` へmergeし、Next.js版への本番切替を完了した。merge commitは `ad0cf7f22bf9b9d3037415e84e3be2ffffd6cbf0`。
- Vercelプロジェクト `diet` はGitHubリポジトリ `infomarunakashouten-coder/fasting-app` と接続済みで、Production Branchは `master`。現行Next.js Production Deploymentは `dpl_5MRQAFFaCjhsDRjUqzY1BwVJewrE`（Ready）。
- `https://fasting-diet.vercel.app` は現行Next.js Productionを指し、ログイン、既存データ読込、主要画面、ページ遷移、再読込、ブラウザコンソールを確認済み。
- 直前のProduction Deployment `dpl_3FnN8DwLU5n351xfSpxaJpzBMR3X` はReadyのまま削除せず、ロールバック用に保持する。
- 通常開発は、最新の `master` から作業ブランチを作成し、Pull Request、Vercel Preview確認、`master`へのmerge、Production Deployment確認の順で行う。`master`へ直接commit・pushしない。

## 11. 未完了・今後の候補

- Stripe等の実決済、Webhook、購読状態同期、返金・解約フロー。
- 特定商取引法表記、運営者情報、問い合わせ先、正式な返金・障害方針。
- 外部AIによる食事写真判定・コメント生成。現在のAI表示はプレビューのみ。
- 食事時刻の履歴検索範囲は直近5件。長期間空いた場合も正確に前回食事を探すなら、専用クエリまたは食事イベントテーブルを検討。
- 食事時刻の同時刻重複、日付をまたぐ手動修正、誤入力時の計算表示について追加テストが必要。
- 自動テスト（計算ユニットテスト、Supabase互換保存、未保存警告、モバイルE2E）が未整備。
- `npm audit` は2026-08-08の `npm ci` で high severity 6件を報告した。強制更新で壊さず、依存関係とNext.js互換性を調査して段階的に対応する。
- `RELEASE_READINESS.md` の「正式な有料公開前に必須」を継続管理する。

## 12. 変更時に壊しやすい点

- 新旧テーブル／列の互換コードを「重複」に見えても削除しない。削除するなら本番データ移行と検証を先に行う。
- Supabaseクエリの `onConflict: "user_id,recorded_date"` はDBの一意制約が前提。制約を変更するとupsertが壊れる。
- `daily_conditions.meal_times` はPostgres `text[]`。JSON文字列へ勝手に変えない。
- 日付は日本のローカル日付を `YYYY-MM-DDT00:00:00` として扱う箇所が多い。UTC変換を混ぜると日付ずれする。
- 食事間隔計算は時刻の昇順と日付を組み合わせる。単純な文字列差分やUTC日時へ置換しない。
- フェーズ日数はプリセットとの後方互換ロジックを持つ。`prep_days/main_days/recovery_days` が有効ならその合計を優先し、旧 `duration_days` はフォールバック。
- 課金無効時は `hasPremiumAccess` が全員に真を返す。UIだけを見て有料ユーザーだと判断しない。
- 健康情報をコンソール、Vercelログ、エラー文へ出さない。anon key以外の秘密鍵をクライアントへ追加しない。
- RLSや退会RPCを変える際は `security_hardening_part1/2/3.sql` とバックアップ対象テーブルも同時確認。
- `src/app/fasting/page.tsx`、`settings/page.tsx` は大きい。無関係な一括整形や全面書換えを避ける。

## 13. Supabase運用

- 本番SupabaseプロジェクトID：`nnhvxnqwbuxnqjrodzkp`。
- SQL Editor：`https://supabase.com/dashboard/project/nnhvxnqwbuxnqjrodzkp/sql/new`。
- 現行必須SQLの順序は `supabase/README.md` を参照。セキュリティ分割SQLがRLSの現行ソース。
- 追加SQLはできる限り `if not exists`、既存行を壊さない制約追加、再実行可能な形にする。
- 新しい列・テーブルをコードで使用する前に、SQLファイルを追加し、本番適用手順を明示する。DB未適用のまま本番コードを先に出して保存機能を壊さない。
- スキーマ変更後は、保存、再読込、別日記録、削除、RLS（別ユーザーから見えないこと）を確認する。

## 14. Vercelデプロイ

- `.vercel/project.json`：project name `diet`、project ID `prj_enUb2rxc8qDEP6hTRJG3xH5M53VM`、org ID `team_z2RhiDUSgW3VPqpzh5NvY1K2`。
- GitHubリポジトリ `infomarunakashouten-coder/fasting-app` と接続済み。Production Branchは `master`。
- `fasting-diet.vercel.app` はProject Settings → DomainsにProduction Domainとして正式登録済み。Auto-assign Custom Production DomainsはEnabled。
- Vercel CLIは認証期限切れになることがある。その場合は `npx.cmd vercel login` で再認証する。
- 通常は作業ブランチをpushしてPRを作成し、Vercel PreviewがReadyであることと主要機能を確認してから `master` へmergeする。`master`へのmergeでProduction Deploymentが自動作成されるため、手動Production Deployを重ねて実行しない。
- Production DeploymentがReadyになったら、Deployment URLと利用URLを確認し、`npx.cmd vercel inspect fasting-diet.vercel.app` でProduction Domainが同じDeployment IDを指すことを確認する。
- 通常運用では `vercel alias set` による本番URLの手動切替を行わない。自動切替されない場合は、Project Domains、Production Branch、Auto-assign設定を調査し、手動変更前に停止する。
- `inspect` で、`fasting-diet.vercel.app` が今回作成した deployment ID、`target production`、`Ready` を指していることを確認してから完了報告する。
- alias変更は新ProductionのReadyとDeployment URLでの検証後に限る。異常時は直前の正常なProduction Deploymentへaliasを戻し、旧Deploymentは確認が終わるまで削除しない。
- `.vercel` のリンク先を推測で変更しない。プロジェクト名は `diet`、利用URLはProduction Domainとして登録した `fasting-diet.vercel.app` であり、名前が異なっていても正常な構成である。

## 15. 今後のCodex作業ルール

1. 作業開始時にこの `AGENTS.md`、対象コード、`supabase/README.md`、関連SQLを読む。会話の記憶だけで実装しない。
2. 既存ユーザーのデータを最優先し、互換レイヤーとRLSを維持する。破壊的SQL、列削除、型変更は明示的な移行計画なしに行わない。
3. 健康関連仕様は安全側にする。16時間などを万人向けの推奨・達成義務として表現せず、体調・持病・服薬時の注意を維持する。
4. UI変更は430px前後のスマートフォン表示、固定ナビ、セーフエリア、長い日本語、実際の入力状態で確認する。
5. 保存処理変更時は、成功後スナップショット、未保存警告、二重タップ防止、エラー時の再試行を確認する。
6. DB変更には再実行可能なSQLを `supabase/` に追加し、`supabase/README.md` の適用順も更新する。
7. 実装後は最低限 `npx.cmd tsc --noEmit`。可能なら `npm.cmd run build`。Vercel本番ビルドの成功をローカル型チェックの代用にしない。
8. デプロイを依頼された場合は、ProductionがReadyになった後、`fasting-diet.vercel.app` が自動的に同じDeploymentへ切り替わったことを `inspect` で確認する。通常運用で手動alias設定を行わない。
9. 不要な依存追加、大規模リファクタ、無関係な整形を避ける。既存のユーザー変更を上書きしない。
10. 新機能・仕様・DB列・運用上の罠を追加または変更したら、このファイルも更新する。
