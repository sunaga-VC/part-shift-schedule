import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/adminApi";

/** 接続先 DB の既存メール → ログイン用メール + パスワード */
const profileSeeds = [
  {
    currentEmail: "vegeintern01@vegecoop.co.jp",
    loginEmail: "recruiting@example.co.jp",
    password: "admin01",
    lastName: "管理者",
    firstName: "",
    role: "admin" as const,
    adminPermission: "manager" as const,
    departmentName: "リクルーティング",
    managedDepartments: ["リクルーティング", "第1チーム", "第2チーム", "第3チーム"],
  },
  {
    currentEmail: "j_kyo@vegecoop.co.jp",
    loginEmail: "j_kyo@vegecoop.co.jp",
    password: "general1",
    lastName: "一般管理者",
    firstName: "",
    role: "admin" as const,
    adminPermission: "general" as const,
    departmentName: "第1チーム",
    managedDepartments: ["第1チーム"],
  },
  {
    currentEmail: "shibata@vegecoop.co.jp",
    loginEmail: "sales1@example.com",
    password: "pass001",
    lastName: "田中",
    firstName: "太郎",
    role: "worker" as const,
    adminPermission: "general" as const,
    departmentName: "第1チーム",
    managedDepartments: [] as string[],
  },
  {
    currentEmail: "partsaiyo@vegecoop.co.jp",
    loginEmail: "partsaiyo@vegecoop.co.jp",
    password: "part001",
    lastName: "アルバイト管理者",
    firstName: "",
    role: "admin" as const,
    adminPermission: "part_time_admin" as const,
    departmentName: "第2チーム",
    managedDepartments: ["第2チーム", "第3チーム"],
  },
  {
    currentEmail: "sunaga@vegegoop.co.jp",
    loginEmail: "sunaga@vegecoop.co.jp",
    password: "pass002",
    lastName: "佐藤",
    firstName: "花子",
    role: "worker" as const,
    adminPermission: "general" as const,
    departmentName: "第2チーム",
    managedDepartments: [] as string[],
  },
] as const;

export async function POST() {
  if (process.env.NODE_ENV === "production") {
    return NextResponse.json({ ok: false, message: "Not available in production." }, { status: 404 });
  }

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json({ ok: false, message: "Service client is unavailable." }, { status: 500 });
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

    for (const seed of profileSeeds) {
      const { data: profile } = await service
        .from("staff_profiles")
        .select("id")
        .or(`email.eq.${seed.currentEmail},email.eq.${seed.loginEmail}`)
        .maybeSingle();

      if (!profile) {
        results.push(`SKIP ${seed.loginEmail}: profile not found`);
        continue;
      }

      const departmentId = departmentByName[seed.departmentName] ?? null;

      const { error: profileUpdateError } = await service
        .from("staff_profiles")
        .update({
          email: seed.loginEmail,
          last_name: seed.lastName,
          first_name: seed.firstName,
          display_given_name: seed.firstName.length > 0,
          icon_label: seed.lastName.slice(0, 1),
          department_id: departmentId,
          role: seed.role,
          admin_permission: seed.adminPermission,
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

      const existingAuth = (authData?.users ?? []).find(
        (u) => u.email?.toLowerCase() === seed.loginEmail.toLowerCase()
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
