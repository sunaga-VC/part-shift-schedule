import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getServiceClient } from "@/lib/supabase/adminApi";
import { mapStaffProfile, type StaffBootstrap } from "@/lib/supabase/staff";

type ProfileWithRaises = Parameters<typeof mapStaffProfile>[0];

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const authUserId = user?.id ?? "";
    const email = user?.email?.trim().toLowerCase() ?? "";
    if (!authUserId) {
      return NextResponse.json({ ok: false, message: "ログインが必要です。" }, { status: 401 });
    }

    const service = getServiceClient();
    if (!service) {
      return NextResponse.json({ ok: false, message: "Service client is unavailable." }, { status: 500 });
    }

    const departmentResult = await service
      .from("departments")
      .select("id, name, sort_order")
      .order("sort_order", { ascending: true });
    if (departmentResult.error) {
      return NextResponse.json({ ok: false, message: departmentResult.error.message }, { status: 500 });
    }

    const profileResult = await service.from("staff_profiles").select("*, salary_raises(*)");
    if (profileResult.error) {
      return NextResponse.json({ ok: false, message: profileResult.error.message }, { status: 500 });
    }

    const managedResult = await service.from("staff_managed_departments").select("staff_id, department_id");
    if (managedResult.error) {
      console.warn("staff_managed_departments fetch failed", managedResult.error.message);
    }

    const departmentRows = departmentResult.data ?? [];
    const departmentNameById = Object.fromEntries(departmentRows.map((d) => [d.id, d.name]));
    const managedTeamsByStaffId = new Map<string, string[]>();
    for (const row of managedResult.data ?? []) {
      const name = departmentNameById[row.department_id];
      if (!name) continue;
      const list = managedTeamsByStaffId.get(row.staff_id) ?? [];
      list.push(name);
      managedTeamsByStaffId.set(row.staff_id, list);
    }

    const rows = profileResult.data ?? [];
    let rawCurrent = rows.find((row) => row.id === authUserId);
    if (!rawCurrent && email) {
      rawCurrent = rows.find((row) => (row.email ?? "").toLowerCase() === email);
    }
    if (!rawCurrent) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "staff_profiles にこのユーザーの行がありません。マスタ管理で登録したログインメールと Auth のメールが一致しているか確認してください。",
        },
        { status: 404 }
      );
    }

    const staffList = (profileResult.data ?? []).map((row) =>
      mapStaffProfile(row as ProfileWithRaises, departmentNameById, managedTeamsByStaffId.get(row.id) ?? [])
    );
    const current = mapStaffProfile(
      rawCurrent as ProfileWithRaises,
      departmentNameById,
      managedTeamsByStaffId.get(rawCurrent.id) ?? []
    );

    const bootstrap: StaffBootstrap = {
      userId: current.id,
      departments: departmentRows.map((d) => d.name).filter((name) => name !== "本部"),
      staffList,
    };

    return NextResponse.json({ ok: true, bootstrap });
  } catch (error) {
    const message = error instanceof Error ? error.message : "プロフィール取得に失敗しました。";
    console.error("bootstrap/staff failed", error);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
