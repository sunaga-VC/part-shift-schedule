# Supabase スキーマ方針（シフト調整アプリ）

現行の `localStorage`（`AppState`）を、正規化した Postgres テーブルへ置き換えるための設計です。

**注意:** 既存の別プロダクト用 Supabase プロジェクト（採用管理など）には適用しないでください。このアプリ専用プロジェクトを新規作成してください。

## 旧モデル → 新テーブル

| 旧 (AppState) | 新テーブル | 変更点 |
|---|---|---|
| `departments: string[]` | `departments` | UUID PK。`is_fixed` で固定部署 |
| `staffList` | `staff_profiles` | `auth.users` と 1:1。**平文 password 廃止** |
| `staff.salaryHistory` | `salary_raises` | 正規化 |
| `staff.team` (文字列) | `department_id` FK | 所属はマスタ参照 |
| `period` | `shift_periods` | 複数期間に拡張可能 |
| `desiredShifts` | `desired_shifts` | `date` → `work_date` |
| `confirmedShifts` | `confirmed_shifts` | 同上。公開は `published_at` |
| `goalBlocksByDate` | `goal_block_slots` | 日付×ブロック×スロット行 |
| `requiredShifts` | `required_shifts` | メモ用途。分数は goal からも算出可 |
| `homeMessages` | `home_messages` | `team` 文字列 → `department_id` |
| `currentUserId` | `auth.uid()` | セッションで解決 |

## 権限（RLS）

- 判定は **`staff_profiles.role` / `admin_permission`**（`user_metadata` は使わない）
- アルバイト: 自分の希望、公開済み確定、宛先が自分のメッセージ
- 一般管理者: シフト/目安/メッセージの操作可。スタッフマスタは不可
- マネージャー: マスタ含む全操作

## 接続手順（概要）

1. Supabase で**新規プロジェクト**を作成
2. `supabase link` → `supabase db push`（または SQL Editor でマイグレーション実行）
3. Auth でユーザー作成後、同じ UUID で `staff_profiles` 行を作成
4. `.env.local` に URL / anon key を設定

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

5. アプリ側は `ShiftContext` の localStorage 永続化を、Supabase クライアント呼び出しへ段階移行
