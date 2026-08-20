import type { getServiceClient } from "@/lib/supabase/adminApi";
import { formatAuthUpdateError } from "@/lib/supabase/adminApi";
import canonicalAccountData from "./canonicalAuthAccounts.json";

type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>;

type CanonicalAccountConfig = (typeof canonicalAccountData.accounts)[number];

/** ログイン可能な正規アカウント（これ以外の Auth は削除） */
export type CanonicalAuthAccount = Pick<CanonicalAccountConfig, "loginEmail" | "password" | "matchEmails">;

export const CANONICAL_AUTH_ACCOUNTS: readonly CanonicalAuthAccount[] = canonicalAccountData.accounts.map(
  ({ loginEmail, password, matchEmails }) => ({
    loginEmail,
    password,
    matchEmails,
  })
);

export const CANONICAL_AUTH_ACCOUNT_CONFIGS: readonly CanonicalAccountConfig[] = canonicalAccountData.accounts;

async function listAllAuthUsers(service: ServiceClient) {
  const users: { id: string; email: string | null }[] = [];
  let page = 1;
  const perPage = 1000;
  while (page <= 20) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    users.push(...data.users.map((user) => ({ id: user.id, email: user.email ?? null })));
    if (data.users.length < perPage) break;
    page += 1;
  }
  return users;
}

/**
 * 正規アカウントだけ Auth に残し、メール・パスワードを揃える。
 * staff_profiles.email も loginEmail に更新する。
 */
export async function resetCanonicalAuthAccounts(
  service: ServiceClient
): Promise<{ ok: true; results: string[] } | { ok: false; message: string }> {
  const results: string[] = [];
  const keptProfileIds = new Set<string>();
  const keptEmails = new Set(CANONICAL_AUTH_ACCOUNTS.map((a) => a.loginEmail.toLowerCase()));

  let authUsers = await listAllAuthUsers(service);

  for (const account of CANONICAL_AUTH_ACCOUNTS) {
    const loginEmail = account.loginEmail.toLowerCase();
    const matchSet = account.matchEmails.map((e) => e.toLowerCase());

    const { data: profiles, error: profileError } = await service
      .from("staff_profiles")
      .select("id, email")
      .in("email", matchSet);
    if (profileError) {
      return { ok: false, message: profileError.message };
    }

    const profile = profiles?.[0];
    if (!profile) {
      results.push(`SKIP ${account.loginEmail}: staff_profiles が見つかりません`);
      continue;
    }

    keptProfileIds.add(profile.id);

    const { error: profileUpdateError } = await service
      .from("staff_profiles")
      .update({ email: account.loginEmail, updated_at: new Date().toISOString() })
      .eq("id", profile.id);
    if (profileUpdateError) {
      return { ok: false, message: profileUpdateError.message };
    }
    results.push(`PROFILE ${profile.id} email -> ${account.loginEmail}`);

    for (const aliasEmail of new Set([loginEmail, ...account.matchEmails.map((e) => e.toLowerCase())])) {
      for (const auth of authUsers.filter((u) => u.email?.trim().toLowerCase() === aliasEmail)) {
        if (auth.id === profile.id) continue;
        const { error } = await service.auth.admin.deleteUser(auth.id);
        if (error) {
          return {
            ok: false,
            message: formatAuthUpdateError(`重複 Auth 削除失敗 ${auth.email}: ${error.message}`),
          };
        }
        results.push(`DELETE duplicate auth ${auth.email} id=${auth.id}`);
        authUsers = authUsers.filter((u) => u.id !== auth.id);
      }
    }

    const { data: byId, error: getError } = await service.auth.admin.getUserById(profile.id);
    if (getError) {
      return { ok: false, message: getError.message };
    }

    if (byId.user) {
      const { error: updateError } = await service.auth.admin.updateUserById(profile.id, {
        email: account.loginEmail,
        password: account.password,
        email_confirm: true,
      });
      if (updateError) {
        return {
          ok: false,
          message: formatAuthUpdateError(`Auth 更新失敗 ${account.loginEmail}: ${updateError.message}`),
        };
      }
      results.push(`UPDATE auth ${account.loginEmail}`);
    } else {
      const { error: createError } = await service.auth.admin.createUser({
        id: profile.id,
        email: account.loginEmail,
        password: account.password,
        email_confirm: true,
      });
      if (createError) {
        return {
          ok: false,
          message: formatAuthUpdateError(`Auth 作成失敗 ${account.loginEmail}: ${createError.message}`),
        };
      }
      results.push(`CREATE auth ${account.loginEmail}`);
      authUsers.push({ id: profile.id, email: account.loginEmail });
    }
  }

  authUsers = await listAllAuthUsers(service);
  for (const auth of authUsers) {
    if (keptProfileIds.has(auth.id)) continue;
    const authEmail = auth.email?.trim().toLowerCase() ?? "";
    if (authEmail && keptEmails.has(authEmail)) continue;

    const { error } = await service.auth.admin.deleteUser(auth.id);
    if (error) {
      return {
        ok: false,
        message: formatAuthUpdateError(`Auth 削除失敗 ${auth.email}: ${error.message}`),
      };
    }
    results.push(`DELETE auth ${auth.email ?? auth.id}`);
  }

  return { ok: true, results };
}
