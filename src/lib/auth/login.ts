import { createClient } from "@/lib/supabase/server";
import { getServiceClient, resolveStaffProfileForAuthUser } from "@/lib/supabase/adminApi";
import { normalizeEmailInput } from "@/lib/shift/email";

export type LoginResult =
  | { ok: true; redirectTo: string }
  | { ok: false; error: string };

function resolveDestination(input: {
  next: string;
  role: "admin" | "worker";
  adminPermission: string;
}): string {
  const { next, role, adminPermission } = input;
  if (role === "admin") {
    const canAccessMaster = adminPermission === "manager" || adminPermission === "part_time_admin";
    if (next.startsWith("/admin/master") && canAccessMaster) return next;
    if (next.startsWith("/admin")) return next;
    return "/";
  }
  if (next.startsWith("/admin") || next === "/") return "/shift";
  if (next.startsWith("/")) return next;
  return "/shift";
}

export async function performLogin(input: {
  email: string;
  password: string;
  next?: string;
}): Promise<LoginResult> {
  const email = normalizeEmailInput(input.email);
  const password = input.password;
  const next = (input.next ?? "").trim();

  if (!email || !password) {
    return { ok: false, error: "メールアドレスとパスワードを入力してください。" };
  }

  const supabase = await createClient();

  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({ email, password });
  if (signInError) {
    return {
      ok: false,
      error:
        signInError.message === "Invalid login credentials"
          ? "メールまたはパスワードが正しくありません。"
          : signInError.message,
    };
  }

  const user = signInData.user;
  if (!user) {
    return { ok: false, error: "ログインに失敗しました。" };
  }

  const userEmail = user.email?.trim().toLowerCase() ?? "";
  if (!userEmail) {
    await supabase.auth.signOut();
    return { ok: false, error: "このアカウントにはメールアドレスがありません。" };
  }

  const service = getServiceClient();
  if (!service) {
    await supabase.auth.signOut();
    return {
      ok: false,
      error:
        "サーバー設定が不完全です（SUPABASE_SERVICE_ROLE_KEY）。管理者に Vercel の環境変数設定を依頼してください。",
    };
  }

  const profile = await resolveStaffProfileForAuthUser(service, user.id, userEmail);
  if (!profile || profile.status !== "active") {
    await supabase.auth.signOut();
    return {
      ok: false,
      error: "スタッフ情報と紐づいていません。マスタ管理に登録されているログインメールで試してください。",
    };
  }

  return {
    ok: true,
    redirectTo: resolveDestination({
      next,
      role: profile.role,
      adminPermission: profile.admin_permission,
    }),
  };
}
