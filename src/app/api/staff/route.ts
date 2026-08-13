import { NextResponse } from "next/server";
import {
  requireManagerService,
  requireFullManagerService,
  requireAuthenticatedProfileService,
  getServiceClient,
  findAuthUserByEmail,
  formatAuthUpdateError,
  resolveAuthUserForProfile,
} from "@/lib/supabase/adminApi";
import { removeOrphanAuthUserForEmail } from "@/lib/supabase/syncAuthUsers";
import { canManageAdminAccounts, normalizeAdminPermission } from "@/lib/shift/permissions";
import type { AdminPermission } from "@/lib/shift/types";
import { persistStaffUpdate, persistStaffDelete, type StaffPersistPatch } from "@/lib/supabase/staff";
import { parseLoginEmail } from "@/lib/shift/email";

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
  let body: CreateStaffBody;
  try {
    body = (await request.json()) as CreateStaffBody;
  } catch {
    return NextResponse.json({ ok: false, message: "リクエスト形式が正しくありません。" }, { status: 400 });
  }

  const emailParsed = parseLoginEmail(body.email ?? "");
  if (!emailParsed.ok) {
    return NextResponse.json({ ok: false, message: emailParsed.message }, { status: 400 });
  }
  const email = emailParsed.email;
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

  if (password.length < 6) {
    return NextResponse.json(
      { ok: false, message: "パスワードは6文字以上にしてください。" },
      { status: 400 }
    );
  }

  const auth = role === "admin" ? await requireFullManagerService() : await requireManagerService();
  if (!auth.ok) return auth.response;
  const service = auth.service;

  if (role === "admin" && managedTeams.length === 0) {
    return NextResponse.json(
      { ok: false, message: "管理者には操作できる所属を1つ以上選択してください。" },
      { status: 400 }
    );
  }

  if (role === "worker" && !team) {
    return NextResponse.json({ ok: false, message: "所属は必須です。" }, { status: 400 });
  }

  const { data: duplicatedProfile } = await service
    .from("staff_profiles")
    .select("id")
    .eq("email", email)
    .maybeSingle();
  if (duplicatedProfile) {
    return NextResponse.json(
      { ok: false, message: "このメールアドレスは既に staff_profiles に登録されています。" },
      { status: 400 }
    );
  }

  const duplicatedAuth = await findAuthUserByEmail(service, email);
  if (duplicatedAuth) {
    const { data: profileForAuth } = await service
      .from("staff_profiles")
      .select("id")
      .eq("id", duplicatedAuth.id)
      .maybeSingle();
    if (profileForAuth) {
      return NextResponse.json(
        {
          ok: false,
          message: formatAuthUpdateError("このメールアドレスは Auth に既に登録されています。"),
        },
        { status: 400 }
      );
    }
    const { error: deleteOrphanError } = await service.auth.admin.deleteUser(duplicatedAuth.id);
    if (deleteOrphanError) {
      return NextResponse.json(
        {
          ok: false,
          message: formatAuthUpdateError(
            `孤立 Auth の削除に失敗しました: ${deleteOrphanError.message}`
          ),
        },
        { status: 400 }
      );
    }
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
      {
        ok: false,
        message: formatAuthUpdateError(createError?.message || "Auth ユーザーの作成に失敗しました。"),
      },
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

async function applyAuthCredentialPatch(
  service: ServiceClient,
  staffId: string,
  profileEmail: string,
  password: string,
  email?: string
): Promise<NextResponse> {
  const nextEmail = email ?? "";
  const emailChanging = Boolean(nextEmail) && nextEmail !== profileEmail.trim().toLowerCase();

  let authUser: { id: string; email: string | null } | null = null;
  try {
    authUser = await resolveAuthUserForProfile(service, staffId, profileEmail);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Auth ユーザーの検索に失敗しました。";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
  let authUserId = authUser?.id ?? null;

  if (emailChanging) {
    const { data: duplicated } = await service
      .from("staff_profiles")
      .select("id")
      .eq("email", nextEmail)
      .neq("id", staffId)
      .maybeSingle();
    if (duplicated) {
      return NextResponse.json(
        { ok: false, message: "このメールアドレスは既に使用されています。" },
        { status: 400 }
      );
    }

    const duplicatedAuth = await findAuthUserByEmail(service, nextEmail);
    if (duplicatedAuth && duplicatedAuth.id !== staffId && duplicatedAuth.id !== authUserId) {
      const orphanResult = await removeOrphanAuthUserForEmail(service, staffId, nextEmail);
      if (orphanResult.message) {
        return NextResponse.json(
          { ok: false, message: formatAuthUpdateError(orphanResult.message) },
          { status: 400 }
        );
      }
      if (!orphanResult.removed) {
        return NextResponse.json(
          {
            ok: false,
            message:
              "このメールアドレスは別の Auth ユーザーに登録されています。Supabase Dashboard で重複を確認してください。",
          },
          { status: 400 }
        );
      }
      try {
        authUser = await resolveAuthUserForProfile(service, staffId, profileEmail);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Auth ユーザーの検索に失敗しました。";
        return NextResponse.json({ ok: false, message }, { status: 500 });
      }
      authUserId = authUser?.id ?? staffId;
    }
  }

  const authPatch: { password?: string; email?: string; email_confirm?: boolean } = {};
  if (password) authPatch.password = password;
  if (emailChanging) {
    authPatch.email = nextEmail;
    authPatch.email_confirm = true;
  }

  if (Object.keys(authPatch).length === 0) {
    return NextResponse.json({ ok: true });
  }

  if (!authUserId) {
    const createEmail = nextEmail || profileEmail;
    if (!createEmail || !password) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "Auth ユーザーが見つかりません。パスワードを入力して保存すると、プロフィール ID に紐づく Auth ユーザーを新規作成します。",
        },
        { status: 404 }
      );
    }

    const { data: created, error: createError } = await service.auth.admin.createUser({
      id: staffId,
      email: createEmail,
      password,
      email_confirm: true,
    });
    if (createError || !created.user) {
      return NextResponse.json(
        {
          ok: false,
          message: formatAuthUpdateError(createError?.message || "Auth ユーザーの作成に失敗しました。"),
        },
        { status: 400 }
      );
    }

    if (emailChanging) {
      const { error: profileError } = await service
        .from("staff_profiles")
        .update({ email: nextEmail })
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

  const { error: updateError } = await service.auth.admin.updateUserById(authUserId, authPatch);
  if (updateError) {
    return NextResponse.json(
      { ok: false, message: formatAuthUpdateError(updateError.message || "アカウント情報の更新に失敗しました。") },
      { status: 400 }
    );
  }

  if (emailChanging) {
    const { error: profileError } = await service
      .from("staff_profiles")
      .update({ email: nextEmail })
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

/** ログイン用メール / パスワードの変更（Auth + staff_profiles） */
export async function PATCH(request: Request) {
  const body = (await request.json()) as UpdateAuthBody;
  const staffId = body.id?.trim() ?? "";
  const password = body.password?.trim() ?? "";
  let email = "";
  if (body.email !== undefined && String(body.email).trim()) {
    const emailParsed = parseLoginEmail(String(body.email));
    if (!emailParsed.ok) {
      return NextResponse.json({ ok: false, message: emailParsed.message }, { status: 400 });
    }
    email = emailParsed.email;
  }

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

  // 自分自身のパスワード変更（一般管理者・スタッフも可）
  if (password && !email) {
    const selfAuth = await requireAuthenticatedProfileService();
    if (selfAuth.ok && selfAuth.profileId === staffId) {
      const { data: target, error: targetError } = await selfAuth.service
        .from("staff_profiles")
        .select("id, email")
        .eq("id", staffId)
        .maybeSingle();

      if (targetError || !target) {
        return NextResponse.json(
          { ok: false, message: targetError?.message || "対象ユーザーが見つかりません。" },
          { status: 404 }
        );
      }

      return applyAuthCredentialPatch(selfAuth.service, staffId, target.email ?? "", password);
    }
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

  const profileEmail = (target.email ?? "").trim().toLowerCase();

  return applyAuthCredentialPatch(service, staffId, profileEmail, password, email);
}

type UpdateProfileBody = {
  id: string;
  patch: StaffPersistPatch;
};

/** staff_profiles の部分更新（service role 経由） */
export async function PUT(request: Request) {
  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;
  const service = auth.service;

  const body = (await request.json()) as UpdateProfileBody;
  const staffId = body.id?.trim() ?? "";
  const patch = body.patch ?? {};

  if (!staffId || Object.keys(patch).length === 0) {
    return NextResponse.json(
      { ok: false, message: "対象ユーザーと更新内容が必要です。" },
      { status: 400 }
    );
  }

  const { data: target, error: targetError } = await service
    .from("staff_profiles")
    .select("id, role")
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

  const result = await persistStaffUpdate(service, staffId, patch);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

type DeleteStaffBody = {
  id?: string;
};

/** スタッフ削除（退職フォールバック含む） */
export async function DELETE(request: Request) {
  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as DeleteStaffBody;
  const staffId = body.id?.trim() ?? "";
  if (!staffId) {
    return NextResponse.json({ ok: false, message: "対象ユーザー ID が必要です。" }, { status: 400 });
  }

  const { data: target, error: targetError } = await auth.service
    .from("staff_profiles")
    .select("id, role")
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
      { ok: false, message: "管理者アカウントの削除はマネージャーのみ可能です。" },
      { status: 403 }
    );
  }

  const result = await persistStaffDelete(auth.service, staffId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}

