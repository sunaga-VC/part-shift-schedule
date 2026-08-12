import { NextResponse } from "next/server";
import { requireManagerService } from "@/lib/supabase/adminApi";
import { isFixedDepartmentName } from "@/lib/shift/goal";

type DepartmentBody = {
  name?: string;
  oldName?: string;
  nextName?: string;
};

export async function POST(request: Request) {
  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as DepartmentBody;
  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ ok: false, message: "所属名を入力してください。" }, { status: 400 });
  }
  if (isFixedDepartmentName(name)) {
    return NextResponse.json({ ok: false, message: `${name}は固定の所属です。` }, { status: 400 });
  }

  const { data: existing } = await auth.service
    .from("departments")
    .select("id")
    .eq("name", name)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ ok: true, id: existing.id, existed: true });
  }

  const { data, error } = await auth.service
    .from("departments")
    .insert({
      name,
      is_fixed: false,
      sort_order: 99,
    })
    .select("id")
    .single();

  if (error || !data) {
    const message = error?.message?.includes("permission denied")
      ? "departments への権限がありません。Supabase SQL Editor で GRANT（grant_table_privileges）を実行してください。"
      : error?.message || "所属の追加に失敗しました。";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

export async function PATCH(request: Request) {
  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as DepartmentBody;
  const oldName = body.oldName?.trim() ?? "";
  const nextName = body.nextName?.trim() ?? "";
  if (!oldName || !nextName) {
    return NextResponse.json({ ok: false, message: "所属名を入力してください。" }, { status: 400 });
  }
  if (isFixedDepartmentName(oldName) || isFixedDepartmentName(nextName)) {
    return NextResponse.json({ ok: false, message: "固定の所属は変更できません。" }, { status: 400 });
  }
  if (oldName === nextName) {
    return NextResponse.json({ ok: true });
  }

  const { data: row } = await auth.service
    .from("departments")
    .select("id, is_fixed")
    .eq("name", oldName)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { ok: false, message: `所属「${oldName}」が見つかりません。` },
      { status: 404 }
    );
  }
  if (row.is_fixed) {
    return NextResponse.json({ ok: false, message: "固定の所属は変更できません。" }, { status: 400 });
  }

  const { data, error } = await auth.service
    .from("departments")
    .update({ name: nextName })
    .eq("id", row.id)
    .select("id");

  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }
  if (!data?.length) {
    return NextResponse.json(
      { ok: false, message: `所属「${oldName}」の更新に失敗しました。` },
      { status: 400 }
    );
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as DepartmentBody;
  const name = body.name?.trim() ?? "";
  if (!name) {
    return NextResponse.json({ ok: false, message: "所属名を入力してください。" }, { status: 400 });
  }
  if (isFixedDepartmentName(name)) {
    return NextResponse.json({ ok: false, message: `${name}は削除できません。` }, { status: 400 });
  }

  const { data: row } = await auth.service
    .from("departments")
    .select("id, is_fixed")
    .eq("name", name)
    .maybeSingle();
  if (!row) {
    return NextResponse.json(
      { ok: false, message: `所属「${name}」が見つかりません。` },
      { status: 404 }
    );
  }
  if (row.is_fixed) {
    return NextResponse.json({ ok: false, message: "固定の所属は削除できません。" }, { status: 400 });
  }

  const { error } = await auth.service.from("departments").delete().eq("id", row.id);
  if (error) {
    return NextResponse.json({ ok: false, message: error.message }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
