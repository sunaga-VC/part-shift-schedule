import { NextResponse } from "next/server";
import { requireManagerService, getServiceClient } from "@/lib/supabase/adminApi";
import { canManageAdminAccounts, normalizeAdminPermission } from "@/lib/shift/permissions";
import type { AdminPermission } from "@/lib/shift/types";

type ServiceClient = NonNullable<ReturnType<typeof getServiceClient>>;

type CreateStaffBody = {
  name: string;
  firstName?: string;
  email: string;
  password: string;
  team?: string;
  managedTeams?: string[];
  role: "worker" | "admin";
  adminPermission?: AdminPermission;
  status?: "active" | "inactive";
  weeklyContractHours?: number;
  socialInsurance?: boolean;
  googleEmail?: string;
  hireDate?: string;
  contractStartDate?: string;
  contractEndDate?: string;
  contractRenewalMonths?: number;
  hourlyWage?: number;
  displayGivenName?: boolean;
  note?: string;
};

async function resolveDepartmentId(
  service: ServiceClient,
  team: string
): Promise<{ id?: string; errorMessage?: string }> {
  const isFixedTeam = team === "リクルーティング";
  const sortOrder = team === "リクルーティング" ? 0 : 99;

  const { data: existingDept, error: findDeptError } = await service
    .from("departments")
    .select("id")
    .eq("name", team)
    .maybeSingle();

  let departmentId = existingDept?.id;
  let deptErrorMessage = findDeptError?.message;

  if (!departmentId) {
    const { data: createdDept, error: createDeptError } = await service
      .from("departments")
      .insert({
        name: team,
        is_fixed: isFixedTeam,
        sort_order: sortOrder,
      })
      .select("id")
      .single();

    if (createdDept?.id) {
      departmentId = createdDept.id;
    } else {
      deptErrorMessage = createDeptError?.message || deptErrorMessage;
      const { data: again } = await service.from("departments").select("id").eq("name", team).maybeSingle();
      departmentId = again?.id;
    }
  }

  return { id: departmentId, errorMessage: deptErrorMessage };
}

export async function POST(request: Request) {
  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;
  const service = auth.service;

  const body = (await request.json()) as CreateStaffBody;
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  const role = body.role === "admin" ? "admin" : "worker";
  const managedTeams = [
    ...new Set((body.managedTeams ?? []).map((team) => team.trim()).filter((team) => team && team !== "本部")),
  ];
  const team =
    role === "admin"
      ? managedTeams[0] ?? body.team?.trim() ?? ""
      : body.team?.trim() ?? "";

  if (!email || !password || !name) {
    return NextResponse.json(
      { ok: false, message: "メール・パスワード・名前は必須です。" },
      { status: 400 }
    );
  }

  if (role === "admin" && !canManageAdminAccounts(auth.adminPermission)) {
    return NextResponse.json(
      { ok: false, message: "管理者アカウントの作成はマネージャーのみ可能です。" },
      { status: 403 }
    );
  }

  if (role === "worker" && !team) {
    return NextResponse.json({ ok: false, message: "所属は必須です。" }, { status: 400 });
  }

  if (role === "admin" && managedTeams.length === 0) {
    return NextResponse.json(
      { ok: false, message: "管理者には操作できる所属を1つ以上選択してください。" },
      { status: 400 }
    );
  }

  let departmentId: string | null = null;
  if (team) {
    const resolved = await resolveDepartmentId(service, team);
    if (!resolved.id) {
      const permissionHint = resolved.errorMessage?.includes("permission denied")
        ? " （Supabase で departments への GRANT が未設定です。SQL Editor で grant_table_privileges を実行してください）"
        : "";
      return NextResponse.json(
        {
          ok: false,
          message:
            (resolved.errorMessage ||
              `所属「${team}」を用意できませんでした。Supabase の departments に「${team}」があるか確認してください。`) +
            permissionHint,
        },
        { status: 400 }
      );
    }
    departmentId = resolved.id;
  }

  const managedDepartmentIds: string[] = [];
  if (role === "admin") {
    for (const managedTeam of managedTeams) {
      const resolved = await resolveDepartmentId(service, managedTeam);
      if (!resolved.id) {
        return NextResponse.json(
          { ok: false, message: resolved.errorMessage || `所属「${managedTeam}」を用意できませんでした。` },
          { status: 400 }
        );
      }
      managedDepartmentIds.push(resolved.id);
    }
  }

  const { data: created, error: createError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });

  if (createError || !created.user) {
    return NextResponse.json(
      { ok: false, message: createError?.message || "Auth ユーザーの作成に失敗しました。" },
      { status: 400 }
    );
  }

  const adminPermission = normalizeAdminPermission(role, body.adminPermission);

  const { error: profileError } = await service.from("staff_profiles").insert({
    id: created.user.id,
    last_name: name,
    first_name: body.firstName?.trim() ?? "",
    display_given_name: Boolean(body.displayGivenName),
    icon_label: "",
    department_id: departmentId,
    role,
    admin_permission: adminPermission,
    status: body.status === "inactive" ? "inactive" : "active",
    weekly_contract_hours: body.weeklyContractHours ?? (role === "admin" ? 40 : 20),
    social_insurance: Boolean(body.socialInsurance),
    hire_date: body.hireDate || null,
    contract_start_date: body.contractStartDate || null,
    contract_end_date: body.contractEndDate || null,
    contract_renewal_months: body.contractRenewalMonths ?? 3,
    hourly_wage: body.hourlyWage ?? 0,
    email,
    google_email: body.googleEmail?.trim() ?? "",
    note: body.note?.trim() ?? "",
  });

  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { ok: false, message: `プロフィール作成に失敗: ${profileError.message}` },
      { status: 400 }
    );
  }

  if (managedDepartmentIds.length > 0) {
    const { error: managedError } = await service.from("staff_managed_departments").insert(
      managedDepartmentIds.map((department_id) => ({
        staff_id: created.user.id,
        department_id,
      }))
    );
    if (managedError) {
      await service.auth.admin.deleteUser(created.user.id);
      return NextResponse.json(
        { ok: false, message: `所属権限の保存に失敗: ${managedError.message}` },
        { status: 400 }
      );
    }
  }

  if ((body.hourlyWage ?? 0) > 0) {
    const initialDate = body.hireDate || body.contractStartDate || new Date().toISOString().slice(0, 10);
    await service.from("salary_raises").insert({
      staff_id: created.user.id,
      effective_date: initialDate,
      hourly_wage: body.hourlyWage!,
      note: "初任給",
    });
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}

type UpdateAuthBody = {
  id: string;
  password?: string;
  email?: string;
};

/** ログイン用メール / パスワードの変更（Auth + staff_profiles） */
export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateAuthBody;
  const staffId = body.id?.trim() ?? "";
  const password = body.password?.trim() ?? "";
  const email = body.email?.trim().toLowerCase() ?? "";

  if (!staffId || (!password && !email)) {
    return NextResponse.json(
      { ok: false, message: "対象ユーザーと、変更するメールまたはパスワードが必要です。" },
      { status: 400 }
    );
  }

  if (password && password.length < 6) {
    return NextResponse.json(
      { ok: false, message: "パスワードは6文字以上にしてください。" },
      { status: 400 }
    );
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ ok: false, message: "メールアドレスの形式が正しくありません。" }, { status: 400 });
  }

  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;
  const service = auth.service;

  const { data: target, error: targetError } = await service
    .from("staff_profiles")
    .select("id, role, status, email")
    .eq("id", staffId)
    .maybeSingle();

  if (targetError || !target) {
    return NextResponse.json(
      { ok: false, message: targetError?.message || "対象ユーザーが見つかりません。" },
      { status: 404 }
    );
  }

  if (target.role === "admin" && !canManageAdminAccounts(auth.adminPermission)) {
    return NextResponse.json(
      { ok: false, message: "管理者アカウントの変更はマネージャーのみ可能です。" },
      { status: 403 }
    );
  }

  if (email && email !== (target.email ?? "").toLowerCase()) {
    const { data: duplicated } = await service
      .from("staff_profiles")
      .select("id")
      .eq("email", email)
      .neq("id", staffId)
      .maybeSingle();
    if (duplicated) {
      return NextResponse.json(
        { ok: false, message: "このメールアドレスは既に使用されています。" },
        { status: 400 }
      );
    }
  }

  const authPatch: { password?: string; email?: string; email_confirm?: boolean } = {};
  if (password) authPatch.password = password;
  if (email) {
    authPatch.email = email;
    authPatch.email_confirm = true;
  }

  const { error: updateError } = await service.auth.admin.updateUserById(staffId, authPatch);
  if (updateError) {
    return NextResponse.json(
      { ok: false, message: updateError.message || "アカウント情報の更新に失敗しました。" },
      { status: 400 }
    );
  }

  if (email) {
    const { error: profileError } = await service
      .from("staff_profiles")
      .update({ email })
      .eq("id", staffId);
    if (profileError) {
      return NextResponse.json(
        { ok: false, message: `プロフィールのメール更新に失敗: ${profileError.message}` },
        { status: 400 }
      );
    }
  }

  return NextResponse.json({ ok: true });
}

