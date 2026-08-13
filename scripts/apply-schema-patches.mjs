import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const PATCH_FILES = [
  "20260812230000_add_remote_shift_status.sql",
  "20260812230001_confirmed_shifts_select_policy_remote.sql",
];

function loadEnvLocal() {
  try {
    const raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim();
      if (!(key in process.env)) {
        process.env[key] = value;
      }
    }
  } catch {
    // optional
  }
}

async function verifyRemoteStatus(client) {
  const result = await client.query(
    `select e.enumlabel
     from pg_enum e
     join pg_type t on e.enumtypid = t.oid
     where t.typname = 'confirmed_shift_status'
     order by e.enumsortorder`
  );
  return result.rows.some((row) => row.enumlabel === "remote");
}

async function main() {
  loadEnvLocal();
  const databaseUrl = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("SUPABASE_DB_URL または DATABASE_URL を .env.local に設定してください。");
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();

  try {
    const hasRemote = await verifyRemoteStatus(client);
    const filesToRun = hasRemote ? [PATCH_FILES[1]] : PATCH_FILES;

    for (const fileName of filesToRun) {
      const sql = readFileSync(join(process.cwd(), "supabase", "migrations", fileName), "utf8");
      await client.query(sql);
    }

    if (!(await verifyRemoteStatus(client))) {
      throw new Error("マイグレーション後も remote が enum に見つかりません。");
    }

    console.log(hasRemote ? "RLS ポリシーを更新しました。" : "在宅（remote）ステータスを DB に追加しました。");
  } finally {
    await client.end().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
