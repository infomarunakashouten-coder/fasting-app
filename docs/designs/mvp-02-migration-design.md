# MVP-02 migration 最終設計（DB未適用・アプリ未実装）

2026-09-28 / Asia/Tokyo。最終仕様を反映したレビュー用draft。
基本設計・精度・値域・専用roleのSECURITY DEFINER例外は条件付き承認済み。
DB適用は未承認。アプリ実装・commit・push・PR・deployは今回行わない。
可変SQLには実行阻止ガードを残す。ガード解除は別途承認と検証の後だけ。

## 1. 実Production DBと集計再確認

実DBを正とする。daily_recordsは不存在、新設しない。canonicalはweight_recordsのみ。
weight numeric(5,1) NOT NULL / body_fat_percentage numeric(5,2) NULL。
UNIQUE(user_id,recorded_date)、auth.users FK ON DELETE CASCADE、本人限定RLSを維持。
profilesの健康現在値列・menstrual_cycle_daysは不存在。追加・同期しない。
weight_records独自triggerなし。profilesのsystem-field保護triggerは変更しない。

| 取得済み匿名集計 | 体重 | 体脂肪率 |
|---|---:|---:|
| 対象総行数 | 61 | 61 |
| 非NULL件数 | 61 | 55 |
| NULL件数 | 0 | 6 |
| 最小値 | 50.0 | 25.00 |
| 最大値 | 75.0 | 38.10 |

最終値域で集計SELECTを再実行した結果: 総行数61、体重違反0、体脂肪率違反0、両方NULL0。
個別レコード・識別情報は取得していない。適用直前にも再集計する。
匿名集計も外部Analytics/公開PRへ転載しない。

## 2. 修正版schema

| 対象 | 最終案 |
|---|---|
| weight_records | weightのみNULL可、片方非NULL・値域CHECK。型/一意制約/既存RLSは維持 |
| health_beta_users | user_id UUID PK/FK auth.users CASCADE、created_at NOT NULL DEFAULT now() |
| menstrual_starts | id UUID PK、user_id NOT NULL/FK CASCADE、started_on date NOT NULL、created_at/updated_at NOT NULL、UNIQUE(user_id,started_on) |
| health_save_requests | (user_id,request_id) PK、user_id FK CASCADE、payload_hash 64文字hex、created_atだけ |

receiptには健康値・健康日付・原文・文字起こし・音声を保存しない。
健康テーブルとの相互FKを付けず、健康記録削除後もreceiptを保持する。status列は不要。
両方NULLをCHECKで禁止。未測定はNULLであり0ではない。
既存行/独自列/bmi/作成日時を勝手に変更しない。

## 3. 正式な精度・値域

| 項目 | 値域 | 精度 |
|---|---|---|
| weight | 0 < weight <= 500.0 kg | numeric(5,1)、小数1桁以内 |
| body_fat_percentage | 0 < body_fat_percentage <= 100.00 % | numeric(5,2)、小数2桁以内 |

20kg下限は採用しない。両項目とも0は測定値として拒否する。
これは入力事故防止のtechnical guardであり医学的正常値の判断ではない。
52.6kgは許可、52.65kgは自動丸め禁止・確認修正。
23.45%は許可、23.456%は確認修正。52.60/52.6の数値等価表記は同じ値。

現在のコード（今回未変更）:
- ホーム/体重のJS検証: 体重0超〜500以下、体脂肪率0〜100。stepは両方0.1。
- health-input/validation.ts: 体重20〜500、体脂肪率0〜100。local parserも共有する。
- 解析候補Zodは異常値を修正表示するため広い値域を許す。保存用Zodとは区別する。
- 確認画面にprecisionの明示検証がない。

将来の互換工程Aで parser/解析後validation/確認修正validation/保存Zod/API/RPC/CHECK を統一する。
体脂肪率0%の既存UI許可は正式仕様に合わせて拒否へ変更し、案内文も更新する。
stepは体重0.1、体脂肪率0.01。stepだけをvalidationとしない。
Number化前の数値文字列で精度を検証し、浮動小数点剰余だけの検査を避ける。
極端に長い小数をNumber化して精度違反を消してはいけない。保存API契約は十進文字列表現の
先行検証、またはJSON数値字句を保持する読込を含め別途実装時に確定する。
本RPC draftのvalueはJSON numberで、PostgreSQL JSONBのnumericとして精度を保持して検証する。
APIがJSON.parse後のNumberだけを無条件にこのRPCへ渡す実装は禁止。

RPCはtypmodなしnumericで v = pg_catalog.trunc(v,scale) を検証してから列型へ代入する。
numeric(p,s)はCHECK前に丸めるため、CHECKだけで余分な入力桁は検出できない。
既存authenticated直接書込権限は維持するため、無丸め保証は検証済みUI/API/RPC経路に限定。
任意の外部DBクライアントの直接代入まで無丸めとは断定しない。

## 4. NULL化より先にProductionへ入れる互換修正

順序は A. read path/validation互換修正 → B. Production反映・確認 → C. NULL化migration → D. MVP-02保存。
今回AのコードもBのdeployも開始しない。Cだけを先行適用しない。

正式な現在値取得:
- currentWeight: weight_recordsで weight IS NOT NULL、recorded_date DESC、LIMIT 1。
- currentBodyFat: weight_recordsで body_fat_percentage IS NOT NULL、recorded_date DESC、LIMIT 1。
- 項目ごとに取得日も保持する。最新1行から両項目を取る方式は禁止。
- 表示用30/400件などの履歴limitより古い最新非NULL値も取得できる独立queryを使う。
- 過去日保存で最新値は巻き戻らない。該当非NULL値がなければ「--」、0を補完しない。
- profilesへの新規同期はしない。最新値の根拠を不存在のprofiles健康列に求めない。
- profile初期設定等の既存仕様/互換層は別途扱い、MVP-02で新健康列やdaily_recordsを作らない。

### 変更・監査対象ファイル（計画だけ）

| ファイル | 必要な変更/確認 | 表示への影響 |
|---|---|---|
| src/app/dashboard/page.tsx | records[0]由来の現在体重を独立した最新非NULLqueryへ。項目別値/日付取得、共通validation | 最新が体脂肪率だけでも以前の体重/BMI/目標差を保持 |
| src/app/record/page.tsx | 現在の項目別NULL除外は維持。ただし400件/期間内の先頭を全履歴の現在値と混同しない。体脂肪率step/精度/0拒否 | 入力・編集・履歴/最新値、2桁体脂肪率の表示を丸めない方針を確認 |
| src/app/settings/page.tsx | 既にweight IS NOT NULL + DESC + limit(1)。回帰テスト、プロフィール代替値の優先順位を監査 | 設定/BMIで最新NULL行を採用しない。backup追加はD工程 |
| src/app/fasting/page.tsx | 同様に非NULL体重query実装済み。新旧query優先順位/安全判定を回帰確認 | body-fat-only追加で利用資格を失わせない。BMI安全制限自体は変更しない |
| src/app/graph/page.tsx / src/app/report/page.tsx | 欠測はNULLのまま。reportは系列別filter実装済み。最新値/前回差/集計の母数を確認 | NULLを0へ変換せず、系列別の日付・件数を使う |
| src/lib/health-input/validation.ts / schema.ts / local-parser.ts | >0上限、十進精度、precision_mismatch等、候補/保存schema分離 | 20kg未満を構造的に拒否しない。異常値は修正対象 |
| src/components/HealthRecordInput.tsx | step/修正案内/精度検証を共有 | 解析値を黙って丸めず、修正してから保存 |
| src/lib/weight-records.ts / merge-weight-records.ts / profile-weight.ts / records-chart.ts | 型・Number(null)・同期副作用を監査。既存互換の全面整理はしない | 新たな二重/三重保存を追加しない、欠測/既存表示を維持 |
| src/lib/health-input/__tests__ と新規項目別最新値テスト | 下記fixture/boundary tests追加 | 互換修正をDB NULL化なしでも検証可能 |

共通utilityを追加するなら項目別最新値取得/十進validationに限定する。
設定/ファスティングは既に非NULLqueryがあるため、必要性のない改修は行わない。

### A/B工程のテスト

- 最新行が体脂肪率のみ/体重のみ、項目ごとの最新日が違う、全NULL系列、空履歴。
- 履歴limitより古い非NULL値、未整列fixture、同日unique、過去日追加/修正。
- 最新値削除→項目別前回値、最後の値削除→未記録、BMI/資格/目標差の回帰。
- 0/負数/500/500.1/100/100.01/20未満、52.65/23.456/末尾0/長い小数。
- ローカル/AI/手入力/確認修正の検証一致、表示がNULLを0へ変換しない。
- npm test、tsc、build、diff --check、Previewでfixture/mockテスト。
- BはProductionの既存データでログイン/体重/設定/ファスティング/グラフ確認。
  ProductionへNULLのテスト健康行を先行作成しない。NULLケースは分離DB/fixtureで検証。
- Bの合格後もDB適用は別承認。NULL化後は旧NULL非対応コードへの単純な巻戻しをしない。

## 5. SECURITY DEFINERの条件・権限

receipt直接DMLを禁止しつつ保存RPCだけで記録するため、専用roleのDEFINERを使用する。

| 確認点 | 最終設計 |
|---|---|
| function owner | health_rpc_executor（保存RPCのみ所有） |
| role attributes | NOLOGIN / NOINHERIT / NOSUPERUSER / NOCREATEDB / NOCREATEROLE / NOBYPASSRLS / NOREPLICATION |
| target table ownership | weight/beta/menstrual/receiptのownerにはしない。既存migration管理ownerを維持 |
| table grants | 下表のSELECTと指定列INSERT/UPDATEのみ。DELETEなし |
| RLS | roleは非table-ownerかつ非BYPASSRLS。全対象RLS有効、本人＋beta policyを通す。新3表はFORCE RLS |
| EXECUTE | 公開save RPCだけauthenticatedへ。PUBLIC/anon/service_roleの明示grantなし |
| search_path | 空文字、row_security=on、関数/relationsをschema-qualified、固定SQL |
| revoke timing | CREATE FUNCTION直後にPUBLIC/anon/authenticated/service_roleからREVOKE。同transactionでowner設定後authenticatedだけ再GRANT |
| direct receipts | authenticated/anonはSELECT/INSERT/UPDATE/DELETEすべて不可。betaにも例外なし |

pg_catalog関数とauth.uid()、public各表を明示。CASE/COALESCEはSQL構文であり未修飾関数参照ではない。
trigger補助関数はSECURITY INVOKERで、作成直後にPUBLIC/anon/authenticatedからREVOKE。
postgres/service_role/supabase_admin/BYPASSRLS roleを保存RPC ownerとして使わない。

### 専用roleの最小table privileges

| table | role権限 |
|---|---|
| health_beta_users | SELECTのみ（RLSでauth.uid()本人行） |
| weight_records | SELECT、INSERT(user_id,recorded_date,weight,body_fat_percentage)、UPDATE(weight,body_fat_percentage) |
| menstrual_starts | SELECT、INSERT(user_id,started_on) |
| health_save_requests | SELECT、INSERT(user_id,request_id,payload_hash) |

public/auth schema USAGE、auth.uid() EXECUTEが必要。
これらは専用roleへ必要最小限を直接GRANTし、他roleへのmembershipで権限を取得しない。
public/authのUSAGEは指定した表・auth.uid()の名前解決用でありCREATEを恒久付与しない。
row_security=onはPostgreSQL関数のSET設定として明示する案を採用済み（RPC draft参照）。
これはdefense-in-depthであり、BYPASSRLSやtable-ownerの迂回を打ち消す仕組みではない。
実Supabase version/installer権限での適用試験は未実施。実roleはまだ作成していない。
beta書換、receipt UPDATE/DELETE、profiles/auth.users書換、任意schema CREATEは不要・禁止。
owner変更に必要なpublic CREATEは同transaction内だけ一時付与し即REVOKE。
PUBLIC由来のCREATEが残る場合はSQLが停止する。既存PUBLIC grantを勝手に変更しない。
role membership/default privileges/実効権限はpreflightと分離DBで検証。app roleからSET ROLEできてはいけない。
installer側owner変更権限が足りなければ停止し、postgres所有に代替しない。

## 6. RLSと直接Data APIアクセス

| 対象 | authenticated（beta含む） | health_rpc_executor |
|---|---|---|
| weight_records | 既存本人CRUDを維持 | 本人＋beta SELECT/INSERT/UPDATE |
| health_beta_users | SELECT/DMLとも不可 | 本人SELECT |
| menstrual_starts | 本人SELECTだけ、直接DML不可 | 本人＋beta SELECT/INSERT |
| health_save_requests | SELECT/DMLとも不可 | 本人＋beta SELECT/INSERT |

beta判定はRPC内部だけで実施。自己登録・beta確認の新公開RPCは作らない。
beta登録は運用者が別承認で実施、migrationで誰も自動登録しない。
新表はpublicに置くがData APIからbeta/receiptを読み書きできるgrant/policyを与えない。
既存weightのowner RLS/権限を置き換えずexecutor向けpolicyだけ追加。

生理の直接beta CRUDからRPC-onlyへ絞った理由: beta表のSELECTを公開せず、
書込時のbeta判定と入力検証を一つの監査経路へ閉じるため。
将来編集/削除も限定RPCで本人＋betaチェック、空search_path、最小列UPDATE/DELETE grants、
RLS追加、同transaction EXECUTE制御を設計する。今回SQLは保存RPCのみで、編集削除は未実装。
一般authenticatedユーザーの既存weight操作をbeta化しない。

## 7. 単一RPC・単一transactionと同日保持

入力はrequest_idと確定entriesだけ、user_id/hashをクライアントから受け取らない。
auth.uid()確認 → beta確認 → 入力validation → request_id → canonical hash →
request単位advisory transaction lock → receipt判定 →
weight upsert → menstrual insert → receipt insert → canonical再取得 → return。

1〜8件/8KB、type/occurred_on/value/unitのみ。空、不明キー、不正日付/単位、
NULL測定値、同日同種重複、未来日付、値域/精度違反を拒否する。
period_startは数値/単位なし。サーバーAsia/Tokyoの日付で確認する。
未指定weight/body_fatはON CONFLICT CASE更新で既存値保持。bmi/作成日時/他列を保持。
body-fat-onlyの新規行はweight NULL。profiles/daily_recordsへ書き込まない。
例外を握り潰さず全件rollback。固定エラーのみ返し、SQLERRM/DETAIL/健康値を返さない。

## 8. canonical hash・idempotency

検証済みtype/date/valueをcanonical化しSHA-256。unit/versionは検証済み定数。
日付はYYYY-MM-DD、数値はweight1桁/bodyfat2桁の固定十進文字列、
arrayはdate/type順、objectはJSONBの決定論的表現。raw JSON文字列はhashしない。
key順・entry順・52.6/52.60などでhashが変わらないことをテストする。
原文/音声/文字起こし/識別情報はhash対象に含めない。

同user/request同hash → already_processed=true、DMLなし、現在canonicalを再読込。
異hash → conflict。初回失敗時はreceiptもrollbackされ同IDで再試行可能。
同時同IDはtransaction lockで直列化。別IDの同項目更新は最終書込優先。
既存UIは同lockを共有しない。既存helperの事前読込から両列書込する競合は別タスク。

## 9. 削除後の再送対策

健康記録削除時にreceiptは削除しない。再送branchではINSERT/UPDATEを一切実行しない。
already_processed=true + 空のcanonical配列/missing_entriesで不存在を表す。
項目だけ削除し他項目が残っている場合もmissing_entriesで表す。
同日が別操作で再作成済みならその現在行を返し、元requestの健康値とは説明しない。
receiptにTTLを設けない。status列は追加不要。
hashは匿名化ではないため、直接SELECT/ログ/Analytics公開もしない。

## 10. backup / account deletion

固定backup対象へmenstrual_startsだけ追加。health_save_requests/health_beta_usersは対象外。
restoreでも内部receiptやbeta資格を復元しない。
実退会RPCはinformation_schema.columnsのpublic schema/user_id列を動的列挙し、
本人行を削除後、profiles本人行とauth.users本人行を削除するSQLだった。
新3表はいずれもその対象、さらにauth.users FK ON DELETE CASCADEを持つ。
先行DELETE後のCASCADEは対象行が0件なので安全。DELETEの二重呼出でエラーにはならない。
相互FKなしで表の削除順にも依存しない。退会transactionの途中失敗は全体rollback。
既存管理退会RPCは変更不要。ただし実行権限/RLSを含む専用テストアカウントの実DB検証は未実施。

## 11. Production非公開

UI/parse/transcribeの既存fail-closedを維持。保存/生理編集削除APIもProductionでは認証前404。
Preview対象branchだけflag有効。NEXT_PUBLIC変更後は再build/redeployが必要。
DBはPreview/Productionを区別しないので、beta gateがDB直接RPCを非betaから保護する。
beta登録者は意図的にProduction DBへ書ける。Previewは専用βテスターだけ使用する。

## 12. rollback / forward fix

DDL適用transaction失敗はDDLを含め全rollback。
適用後はflag停止/公開RPC EXECUTE剥奪/executor新規write停止 → データ保全 → 原因修正。
旧コードへ戻さずNULL読取互換を維持。実行中transactionを確認してから修復する。
weight NULL行発生後の単純SET NOT NULL、健康行削除、0埋め、ダミー体重は禁止。
rollback draftにはSET NOT NULLやDROPを含めない。表・receiptを保全する。
既存authenticated weight CRUDは無断停止しない。全既存write停止が必要なら別承認。
再開grantやschema変更も再レビューする。

## 13. 適用前チェックリスト

- [ ] A/B互換修正が別承認で実装/Production確認済み。今回は未実施。
- [ ] 実DB型/nullable/unique/FK/RLS/trigger/退会関数を直前再確認。
- [ ] 集計: 値域違反/両NULL/特殊numeric/精度違反0。CHECK validate後にNULL可。
- [ ] 同名constraint/table/function/roleが既存なら定義を比較。IF NOT EXISTSだけで安全としない。
- [ ] 実PostgreSQL versionでrole作成/owner変更/sha256/grants構文を分離DB検証。
- [ ] executor属性、table非owner、全対象RLS、role membership/実効PUBLIC権限監査。
- [ ] authenticated/anon/betaの直接receipt/beta SELECT/DML拒否、非beta RPC拒否、別ユーザー遮断。
- [ ] 0/負数/上限/上限超え/20未満/precision/空/unknownJSON/date/unit/複数日を検証。
- [ ] 同日片方保持、3件atomic、途中故障rollback、同hash/diffhash、並列再送を検証。
- [ ] 削除後/一項目削除後/同日再作成後の再送で復活しない。
- [ ] 最新値/BMI/グラフ/編集削除/backup/専用テスト退会を確認。
- [ ] DBエラーログ等の値漏洩、lock_timeout/短い適用時間/非破壊停止手順を確認。
- [ ] Production UI/API404とDBbeta制限を再確認。
- [ ] Supabase DB適用は別途明示承認。guardを勝手に外さない。

## 14. 検証状況・残るリスク

今回は5つの設計ファイルだけを更新。変更SQLはPostgreSQLで実行していない。
追記: Step Aのread互換コードは別branch `feature/mvp-02-weight-null-compat` で先行する。
DB設計の承認は適用承認ではない。Productionの手入力validation/保存helperはStep Aで変更せず、
健康入力の値域/精度統一も保存工程で実装する。順序A/B/C/Dと全SQLのguardは維持する。
実DBでは匿名集計SELECTだけ再実行。test/typecheck/build/DB transaction試験の成功とは表現しない。
NULL互換・精度/range・保存UI/API・backup改修は今後のコード工程であり今回は未実装。
role作成/ALTER OWNERはSupabase管理roleで実際に可能か未検証。
DBCHECKは一般手入力にも影響する。直接DB書込の暗黙丸めをこのCHECKだけで防げない。
SHA-256 receiptは退会まで増える。最終一般公開前に保持/消失時の再送保護を再検討する。
hash canonical versionは既存receiptがある限り勝手に変更しない。
ログの固定エラー化だけでDB内部監査ログの無漏洩は保証できない。実設定の確認が必要。

## 15. ファイルと根拠

schema/RPC/rollbackは適用禁止guard付きdraft。preflightはSELECTのみ。
PostgreSQL一般仕様の根拠:
[CREATE FUNCTION](https://www.postgresql.org/docs/current/sql-createfunction.html)、
[RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)、
[Numeric](https://www.postgresql.org/docs/current/datatype-numeric.html)。
実DBをPostgreSQL18と仮定しない。
