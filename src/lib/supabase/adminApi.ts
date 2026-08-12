import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { AdminPermission, Database } from "@/lib/supabase/database.types";
import { canManageAdminAccounts, canManageMaster } from "@/lib/shift/permissions";

function looksLikeServiceRoleKey(key: string): boolean {
  if (!key) return false;
  if (key.startsWith("sb_secret_")) return true;
  if (key.startsWith("sb_publishable_") || key.includes("anon")) return false;
  try {
    const payloadPart = key.split(".")[1];
    if (!payloadPart) return key.startsWith("eyJ");
    const json = Buffer.from(payloadPart, "base64url").toString("utf8");
    const payload = JSON.parse(json) as { role?: string };
    return payload.role === "service_role";
  } catch {
    return key.startsWith("eyJ");
  }
}

export function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return null;
  if (!looksLikeServiceRoleKey(key)) {
    console.error(
      "SUPABASE_SERVICE_ROLE_KEY が service_role ではありません。anon / publishable key が入っている可能性があります。"
    );
    return null;
  }
  return createServiceClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type MasterContext =
  | {
      ok: true;
      userId: string;
      adminPermission: AdminPermission;
      service: NonNullable<ReturnType<typeof getServiceClient>>;
    }
  | { ok: false; response: NextResponse };

async function requireMasterContext(options?: {
  requireFullManager?: boolean;
}): Promise<MasterContext> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, message: "ログインが必要です。" }, { status: 401 }),
    };
  }

  const { data: me } = await supabase
    .from("staff_profiles")
    .select("role, admin_permission, status")
    .eq("id", user.id)
    .maybeSingle();

  const permission = (me?.admin_permission ?? "general") as AdminPermission;
  const allowed = options?.requireFullManager
    ? canManageAdminAccounts(permission)
    : canManageMaster(permission);

  if (!me || me.role !== "admin" || me.status !== "active" || !allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          message: options?.requireFullManager
            ? "マネージャー権限が必要です。"
            : "マスタ管理の権限が必要です。",
        },
        { status: 403 }
      ),
    };
  }

  const service = getServiceClient();
  if (!service) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          ok: false,
          message:
            "SUPABASE_SERVICE_ROLE_KEY が未設定です。Vercel / .env.local に service_role キーを追加してください。",
        },
        { status: 500 }
      ),
    };
  }

  return { ok: true, userId: user.id, adminPermission: permission, service };
}

/** マスタ管理権限（マネージャー / アルバイト管理者）+ service role */
export async function requireManagerService(): Promise<MasterContext> {
  return requireMasterContext();
}

/** 管理者アカウント操作向け（マネージャーのみ） */
export async function requireFullManagerService(): Promise<MasterContext> {
  return requireMasterContext({ requireFullManager: true });
}
