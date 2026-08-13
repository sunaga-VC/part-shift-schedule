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

  const userEmail = user.email?.trim().toLowerCase();
  if (!userEmail) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, message: "メールアドレスが見つかりません。" }, { status: 403 }),
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

  const { data: me } = await service
    .from("staff_profiles")
    .select("role, admin_permission, status")
    .eq("email", userEmail)
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

type AuthenticatedProfileContext =
  | {
      ok: true;
      authUserId: string;
      profileId: string;
      role: "worker" | "admin";
      adminPermission: AdminPermission;
      service: NonNullable<ReturnType<typeof getServiceClient>>;
    }
  | { ok: false; response: NextResponse };

/** ログイン済みユーザー + staff_profiles（email 基準）+ service role */
export async function requireAuthenticatedProfileService(): Promise<AuthenticatedProfileContext> {
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

  const userEmail = user.email?.trim().toLowerCase();
  if (!userEmail) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, message: "メールアドレスが見つかりません。" }, { status: 403 }),
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

  const { data: profile } = await service
    .from("staff_profiles")
    .select("id, role, admin_permission, status")
    .eq("email", userEmail)
    .maybeSingle();

  if (!profile || profile.status !== "active") {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, message: "有効なスタッフプロフィールが見つかりません。" }, { status: 403 }),
    };
  }

  return {
    ok: true,
    authUserId: user.id,
    profileId: profile.id,
    role: profile.role,
    adminPermission: (profile.admin_permission ?? "general") as AdminPermission,
    service,
  };
}

/** ログイン済み管理者 + service role（シフト調整 board 用。マスタ権限は不要） */
export async function requireAdminService(): Promise<AuthenticatedProfileContext | { ok: false; response: NextResponse }> {
  const auth = await requireAuthenticatedProfileService();
  if (!auth.ok) return auth;
  if (auth.role !== "admin") {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, message: "管理者権限が必要です。" }, { status: 403 }),
    };
  }
  return auth;
}

/** auth.users の ID をメールアドレスから解決（staff_profiles.id と一致しない場合に使用） */
export async function findAuthUserIdByEmail(
  service: NonNullable<ReturnType<typeof getServiceClient>>,
  email: string
): Promise<string | null> {
  const user = await findAuthUserByEmail(service, email);
  return user?.id ?? null;
}

/** auth.users をメールアドレスから解決 */
export async function findAuthUserByEmail(
  service: NonNullable<ReturnType<typeof getServiceClient>>,
  email: string
): Promise<{ id: string; email: string | null } | null> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return null;

  let page = 1;
  const perPage = 1000;
  while (page <= 10) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const matched = data.users.find((user) => user.email?.trim().toLowerCase() === normalized);
    if (matched) {
      return { id: matched.id, email: matched.email ?? null };
    }
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

/** ログインに使われる Auth ユーザーを解決（メール優先 → プロフィール ID） */
export async function resolveAuthUserForProfile(
  service: NonNullable<ReturnType<typeof getServiceClient>>,
  staffId: string,
  profileEmail: string
): Promise<{ id: string; email: string | null } | null> {
  const normalized = profileEmail.trim().toLowerCase();
  if (normalized) {
    const byEmail = await findAuthUserByEmail(service, normalized);
    if (byEmail) return byEmail;
  }

  const { data: byId, error } = await service.auth.admin.getUserById(staffId);
  if (!error && byId.user) {
    return { id: byId.user.id, email: byId.user.email ?? null };
  }

  return null;
}

/** Supabase Auth 更新エラーを利用者向けメッセージに変換 */
export function formatAuthUpdateError(message: string): string {
  const normalized = message.trim().toLowerCase();
  if (normalized.includes("already") && normalized.includes("email")) {
    return "このメールアドレスは Auth に既に登録されています。別のメールを使うか、既存アカウントを確認してください。";
  }
  if (normalized.includes("error updating user") || normalized.includes("database error updating user")) {
    return "Auth ユーザーの更新に失敗しました。メールの重複、DB トリガー、Auth 設定を確認してください。";
  }
  if (normalized.includes("password") && normalized.includes("weak")) {
    return "パスワードが弱すぎます。より長いパスワードにしてください。";
  }
  return message;
}
