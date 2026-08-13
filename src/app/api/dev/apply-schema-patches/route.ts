import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { Client } from "pg";

const PATCH_FILES = [
  "20260812230000_add_remote_shift_status.sql",
  "20260812230001_confirmed_shifts_select_policy_remote.sql",
] as const;

function getDatabaseUrl(): string | null {
  return process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? null;
}

async function verifyRemoteStatus(client: Client): Promise<boolean> {
  const result = await client.query<{ enumlabel: string }>(
    `select e.enumlabel
     from pg_enum e
     join pg_type t on e.enumtypid = t.oid
     where t.typname = 'confirmed_shift_status'
     order by e.enumsortorder`
  );
  return result.rows.some((row) => row.enumlabel === "remote");
}

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, message: "Not available in production." }, { status: 404 });
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "SUPABASE_DB_URL または DATABASE_URL が未設定です。Supabase ダッシュボード > Project Settings > Database の接続文字列を .env.local に追加してください。",
      },
      { status: 500 }
    );
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();

    const hasRemote = await verifyRemoteStatus(client);
    if (hasRemote) {
      const policySql = readFileSync(
        join(process.cwd(), "supabase", "migrations", "20260812230001_confirmed_shifts_select_policy_remote.sql"),
        "utf8"
      );
      await client.query(policySql);
      return NextResponse.json({ ok: true, message: "remote は既に存在したため、RLS ポリシーのみ更新しました。" });
    }

    for (const fileName of PATCH_FILES) {
      const sql = readFileSync(join(process.cwd(), "supabase", "migrations", fileName), "utf8");
      await client.query(sql);
    }

    const applied = await verifyRemoteStatus(client);
    if (!applied) {
      return NextResponse.json(
        { ok: false, message: "マイグレーション後も remote が enum に見つかりません。" },
        { status: 500 }
      );
    }

    return NextResponse.json({ ok: true, message: "在宅（remote）ステータスを DB に追加しました。" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schema patch failed.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, message: "Not available in production." }, { status: 404 });
  }

  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    return NextResponse.json({
      ok: false,
      hasDatabaseUrl: false,
      hasRemoteStatus: null,
      message: "SUPABASE_DB_URL が未設定です。",
    });
  }

  const client = new Client({ connectionString: databaseUrl, ssl: { rejectUnauthorized: false } });

  try {
    await client.connect();
    const hasRemoteStatus = await verifyRemoteStatus(client);
    return NextResponse.json({
      ok: true,
      hasDatabaseUrl: true,
      hasRemoteStatus,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Schema check failed.";
    return NextResponse.json({ ok: false, hasDatabaseUrl: true, hasRemoteStatus: null, message }, { status: 500 });
  } finally {
    await client.end().catch(() => undefined);
  }
}
