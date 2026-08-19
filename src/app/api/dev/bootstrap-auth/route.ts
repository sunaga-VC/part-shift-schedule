import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/adminApi";
import type { AdminPermission, StaffRole } from "@/lib/shift/types";
import canonicalAccountData from "@/lib/supabase/canonicalAuthAccounts.json";

type CanonicalBootstrapAccount = (typeof canonicalAccountData.accounts)[number];
type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>;

const profileSeeds: readonly CanonicalBootstrapAccount[] = canonicalAccountData.accounts;

function seedRole(role: string): StaffRole {
  return role === "admin" ? "admin" : "worker";
}

function seedAdminPermission(permission: string): AdminPermission {
  if (permission === "manager" || permission === "part_time_admin") return permission;
  return "general";
}

async function ensureDepartment(
  service: ServiceClient,
  departmentByName: Record<string, string>,
  name: string
): Promise<string | null> {
  if (!name) return null;
  const existing = departmentByName[name];
  if (existing) return existing;

  const { data, error } = await service
    .from("departments")
    .insert({ name, is_fixed: false, sort_order: 99 })
    .select("id")
    .maybeSingle();
  if (error) {
    const { data: found } = await service.from("departments").select("id").eq("name", name).maybeSingle();
    if (found?.id) {
      departmentByName[name] = found.id;
      return found.id;
    }
    throw error;
  }
  if (!data?.id) return null;
  departmentByName[name] = data.id;
  return data.id;
}

export async function POST(request: Request) {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, message: "Not available in production." }, { status: 404 });
  }

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, message: "Service client is unavailable." }, { status: 500 });
  }

  let onlyEmail = "";
  try {
    const body = (await request.json()) as { account?: string };
    onlyEmail = String(body.account ?? "").trim().toLowerCase();
  } catch {
    onlyEmail = "";
  }

  try {
    const { data: authData, error: listError } = await service.auth.admin.listUsers();
    if (listError) throw listError;

    const { data: departments, error: deptError } = await service
      .from("departments")
      .select("id, name");
    if (deptError) throw deptError;

    const departmentByName = Object.fromEntries((departments ?? []).map((d) => [d.name, d.id]));
    const results: string[] = [];
    const seeds = onlyEmail
      ? profileSeeds.filter((seed) => seed.loginEmail.toLowerCase() === onlyEmail)
      : profileSeeds;

    for (const seed of seeds) {
      let { data: profile } = await service
        .from("staff_profiles")
        .select("id")
        .in("email", seed.matchEmails)
        .maybeSingle();

      const departmentId = await ensureDepartment(service, departmentByName, seed.departmentName);
      for (const deptName of seed.managedDepartments) {
        await ensureDepartment(service, departmentByName, deptName);
      }

      let createdNow = false;
      if (!profile) {
        const existingAuth = (authData?.users ?? []).find((user) =>
          seed.matchEmails.some((alias) => user.email?.toLowerCase() === alias.toLowerCase())
        );
        const authId = existingAuth?.id;
        const createdAuth = authId
          ? null
          : await service.auth.admin.createUser({
              email: seed.loginEmail,
              password: seed.password,
              email_confirm: true,
            });
        if (createdAuth?.error || (!authId && !createdAuth?.data.user)) {
          throw createdAuth?.error ?? new Error(`Auth 作成失敗 ${seed.loginEmail}`);
        }
        const profileId = authId ?? createdAuth?.data.user?.id;
        if (!profileId) throw new Error(`Auth ID を取得できません ${seed.loginEmail}`);

        if (authId) {
          const { error: updateAuthError } = await service.auth.admin.updateUserById(authId, {
            email: seed.loginEmail,
            password: seed.password,
            email_confirm: true,
          });
          if (updateAuthError) throw updateAuthError;
        }

        const { error: insertError } = await service.from("staff_profiles").insert({
          id: profileId,
          email: seed.loginEmail,
          last_name: seed.lastName,
          first_name: seed.firstName,
          display_given_name: seed.firstName.length > 0,
          icon_label: seed.lastName.slice(0, 1),
          department_id: departmentId,
          role: seedRole(seed.role),
          admin_permission: seedAdminPermission(seed.adminPermission),
          status: "active",
        });
        if (insertError) throw insertError;
        profile = { id: profileId };
        createdNow = true;
        results.push(`CREATE ${seed.loginEmail}`);
      }

      if (!profile) {
        results.push(`SKIP ${seed.loginEmail}: profile not found`);
        continue;
      }

      const { error: profileUpdateError } = await service
        .from("staff_profiles")
        .update({
          email: seed.loginEmail,
          last_name: seed.lastName,
          first_name: seed.firstName,
          display_given_name: seed.firstName.length > 0,
          icon_label: seed.lastName.slice(0, 1),
          department_id: departmentId,
          role: seedRole(seed.role),
          admin_permission: seedAdminPermission(seed.adminPermission),
          status: "active",
          updated_at: new Date().toISOString(),
        })
        .eq("id", profile.id);
      if (profileUpdateError) throw profileUpdateError;

      await service.from("staff_managed_departments").delete().eq("staff_id", profile.id);
      for (const deptName of seed.managedDepartments) {
        const deptId = departmentByName[deptName];
        if (!deptId) continue;
        await service.from("staff_managed_departments").insert({ staff_id: profile.id, department_id: deptId });
      }

      if (!createdNow) {
        const existingAuth = (authData?.users ?? []).find(
          (u) => u.email?.toLowerCase() === seed.loginEmail.toLowerCase() || u.id === profile.id
        );
        if (existingAuth) {
          const { error } = await service.auth.admin.updateUserById(existingAuth.id, {
            password: seed.password,
          });
          if (error) throw error;
        } else {
          const { error } = await service.auth.admin.createUser({
            id: profile.id,
            email: seed.loginEmail,
            password: seed.password,
            email_confirm: true,
          });
          if (error) throw error;
        }
      }

      results.push(`OK ${seed.loginEmail}`);
    }

    return NextResponse.json({ ok: true, results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to bootstrap auth users.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}

export async function GET() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, message: "Not available in production." }, { status: 404 });
  }

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, message: "Service client is unavailable." }, { status: 500 });
  }

  const [{ data: authUsers, error: authError }, { data: profiles, error: profileError }] = await Promise.all([
    service.auth.admin.listUsers(),
    service.from("staff_profiles").select("id, email, last_name, role, admin_permission"),
  ]);

  if (authError) return NextResponse.json({ ok: false, message: authError.message }, { status: 500 });
  if (profileError) return NextResponse.json({ ok: false, message: profileError.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    authUsers: (authUsers?.users ?? []).map((u) => ({ id: u.id, email: u.email })),
    profiles: profiles ?? [],
  });
}
