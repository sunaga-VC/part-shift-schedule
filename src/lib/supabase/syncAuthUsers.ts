import type { getServiceClient } from "@/lib/supabase/adminApi";
import { formatAuthUpdateError } from "@/lib/supabase/adminApi";

type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>;

type AuthUser = {
  id: string;
  email?: string | null;
};

async function listAllAuthUsers(service: ServiceClient): Promise<AuthUser[]> {
  const users: AuthUser[] = [];
  let page = 1;
  const perPage = 1000;

  while (page <= 20) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users.map((user) => ({ id: user.id, email: user.email })));
    if (data.users.length < perPage) break;
    page += 1;
  }

  return users;
}

/**
 * staff_profiles.email（UI の正）に合わせて Auth を整理する。
 * - プロフィール ID 以外で同じメールの Auth は削除
 * - プロフィール ID の Auth メールを staff_profiles.email に同期
 * - どのプロフィールにも無い Auth は削除
 */
export async function syncAuthUsersToStaffProfiles(
  service: ServiceClient
): Promise<{ ok: true; results: string[] } | { ok: false; message: string }> {
  const results: string[] = [];

  const { data: profiles, error: profileError } = await service
    .from("staff_profiles")
    .select("id, email, last_name, role");
  if (profileError) {
    return { ok: false, message: profileError.message };
  }

  const profileRows = profiles ?? [];
  const profileIds = new Set(profileRows.map((row) => row.id));
  const canonicalEmails = new Set(
    profileRows.map((row) => (row.email ?? "").trim().toLowerCase()).filter(Boolean)
  );

  let authUsers: AuthUser[];
  try {
    authUsers = await listAllAuthUsers(service);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth ユーザー一覧の取得に失敗しました。";
    return { ok: false, message };
  }

  for (const profile of profileRows) {
    const email = (profile.email ?? "").trim().toLowerCase();
    if (!email) {
      results.push(`SKIP ${profile.id}: staff_profiles.email が空`);
      continue;
    }

    for (const auth of authUsers.filter((user) => user.email?.trim().toLowerCase() === email)) {
      if (auth.id === profile.id) continue;
      const { error } = await service.auth.admin.deleteUser(auth.id);
      if (error) {
        return {
          ok: false,
          message: formatAuthUpdateError(
            `重複 Auth の削除に失敗 (${auth.email}, ${auth.id}): ${error.message}`
          ),
        };
      }
      results.push(`DELETE duplicate auth ${auth.email} id=${auth.id} (keep profile ${profile.id})`);
      authUsers = authUsers.filter((user) => user.id !== auth.id);
    }

    const { data: byId, error: getError } = await service.auth.admin.getUserById(profile.id);
    if (getError) {
      return { ok: false, message: getError.message };
    }

    if (!byId.user) {
      results.push(`WARN ${profile.id}: Auth ユーザーなし（パスワード変更時に作成してください）`);
      continue;
    }

    if ((byId.user.email ?? "").trim().toLowerCase() !== email) {
      const { error: updateError } = await service.auth.admin.updateUserById(profile.id, {
        email,
        email_confirm: true,
      });
      if (updateError) {
        return {
          ok: false,
          message: formatAuthUpdateError(
            `Auth メール同期に失敗 (${profile.id} -> ${email}): ${updateError.message}`
          ),
        };
      }
      results.push(`SYNC auth ${profile.id} email -> ${email}`);
    }
  }

  for (const auth of [...authUsers]) {
    const authEmail = (auth.email ?? "").trim().toLowerCase();
    if (profileIds.has(auth.id)) continue;
    if (authEmail && canonicalEmails.has(authEmail)) continue;

    const { error } = await service.auth.admin.deleteUser(auth.id);
    if (error) {
      return {
        ok: false,
        message: formatAuthUpdateError(`未使用 Auth の削除に失敗 (${auth.email}): ${error.message}`),
      };
    }
    results.push(`DELETE orphan auth ${auth.email ?? "(no email)"} id=${auth.id}`);
  }

  return { ok: true, results };
}

/** 指定メールの Auth がプロフィール ID と食い違う重複なら削除 */
export async function removeOrphanAuthUserForEmail(
  service: ServiceClient,
  profileId: string,
  email: string
): Promise<{ removed: boolean; message?: string }> {
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { removed: false };

  const { data, error } = await service.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;

  const matches = data.users.filter((user) => user.email?.trim().toLowerCase() === normalized);
  let removed = false;

  for (const auth of matches) {
    if (auth.id === profileId) continue;
    const { data: ownerProfile } = await service
      .from("staff_profiles")
      .select("id")
      .eq("id", auth.id)
      .maybeSingle();
    if (ownerProfile) continue;

    const { error: deleteError } = await service.auth.admin.deleteUser(auth.id);
    if (deleteError) {
      return { removed, message: deleteError.message };
    }
    removed = true;
  }

  return { removed };
}
