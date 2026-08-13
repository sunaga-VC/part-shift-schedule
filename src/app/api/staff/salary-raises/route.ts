import { NextResponse } from "next/server";
import { requireManagerService } from "@/lib/supabase/adminApi";
import { persistSalaryRaise, persistSalaryRaiseUpdate } from "@/lib/supabase/staff";

type SalaryRaiseBody = {
  staffId?: string;
  raiseId?: string;
  effectiveDate?: string;
  hourlyWage?: number;
  note?: string;
};

/** 昇給記録の追加 */
export async function POST(request: Request) {
  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as SalaryRaiseBody;
  const staffId = body.staffId?.trim() ?? "";
  const effectiveDate = body.effectiveDate?.trim() ?? "";
  const hourlyWage = Number(body.hourlyWage);
  const note = body.note?.trim() ?? "";

  if (!staffId || !effectiveDate) {
    return NextResponse.json({ ok: false, message: "スタッフ ID と適用日は必須です。" }, { status: 400 });
  }
  if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
    return NextResponse.json({ ok: false, message: "時給を正しく入力してください。" }, { status: 400 });
  }

  try {
    const result = await persistSalaryRaise(auth.service, staffId, { effectiveDate, hourlyWage, note });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "昇給の保存に失敗しました。";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}

/** 昇給記録の更新 */
export async function PUT(request: Request) {
  const auth = await requireManagerService();
  if (!auth.ok) return auth.response;

  const body = (await request.json()) as SalaryRaiseBody;
  const staffId = body.staffId?.trim() ?? "";
  const raiseId = body.raiseId?.trim() ?? "";
  const effectiveDate = body.effectiveDate?.trim() ?? "";
  const hourlyWage = Number(body.hourlyWage);
  const note = body.note?.trim() ?? "";

  if (!staffId || !raiseId || !effectiveDate) {
    return NextResponse.json(
      { ok: false, message: "スタッフ ID・昇給 ID・適用日は必須です。" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(hourlyWage) || hourlyWage < 0) {
    return NextResponse.json({ ok: false, message: "時給を正しく入力してください。" }, { status: 400 });
  }

  try {
    const result = await persistSalaryRaiseUpdate(auth.service, staffId, raiseId, {
      effectiveDate,
      hourlyWage,
      note,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "昇給履歴の更新に失敗しました。";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
