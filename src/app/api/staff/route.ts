import { createClient as createServiceClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type CreateStaffBody = {
  name: string;
  firstName?: string;
  email: string;
  password: string;
  team: string;
  role: "worker" | "admin";
  adminPermission?: "manager" | "general";
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
};

function getServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) return null;
  return createServiceClient<Database>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "ログインが必要です。" }, { status: 401 });
  }

  const { data: me } = await supabase
    .from("staff_profiles")
    .select("role, admin_permission, status")
    .eq("id", user.id)
    .maybeSingle();

  if (!me || me.role !== "admin" || me.admin_permission !== "manager" || me.status !== "active") {
    return NextResponse.json({ ok: false, message: "マネージャー権限が必要です。" }, { status: 403 });
  }

  const service = getServiceClient();
  if (!service) {
    return NextResponse.json(
      {
        ok: false,
        message:
          "SUPABASE_SERVICE_ROLE_KEY が未設定です。.env.local に service_role キーを追加してください。",
      },
      { status: 500 }
    );
  }

  const body = (await request.json()) as CreateStaffBody;
  const email = body.email?.trim().toLowerCase() ?? "";
  const password = body.password?.trim() ?? "";
  const name = body.name?.trim() ?? "";
  const team = body.team?.trim() ?? "";

  if (!email || !password || !name || !team) {
    return NextResponse.json(
      { ok: false, message: "メール・パスワード・名前・所属は必須です。" },
      { status: 400 }
    );
  }

  const { data: department } = await service
    .from("departments")
    .select("id")
    .eq("name", team)
    .maybeSingle();

  let departmentId = department?.id;
  if (!departmentId) {
    const { data: createdDept, error: deptError } = await service
      .from("departments")
      .insert({ name: team, is_fixed: team === "リクルーティング" || team === "本部", sort_order: 99 })
      .select("id")
      .single();
    if (deptError || !createdDept) {
      return NextResponse.json(
        { ok: false, message: `所属「${team}」が見つかりません。先にチームを追加してください。` },
        { status: 400 }
      );
    }
    departmentId = createdDept.id;
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

  const role = body.role === "admin" ? "admin" : "worker";
  const adminPermission =
    role === "admin" ? (body.adminPermission === "general" ? "general" : "manager") : "general";

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
  });

  if (profileError) {
    await service.auth.admin.deleteUser(created.user.id);
    return NextResponse.json(
      { ok: false, message: `プロフィール作成に失敗: ${profileError.message}` },
      { status: 400 }
    );
  }

  if ((body.hourlyWage ?? 0) > 0 && body.hireDate) {
    await service.from("salary_raises").insert({
      staff_id: created.user.id,
      effective_date: body.hireDate,
      hourly_wage: body.hourlyWage!,
      note: "初任給",
    });
  }

  return NextResponse.json({ ok: true, id: created.user.id });
}
