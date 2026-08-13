import { NextResponse } from "next/server";
import { requireAuthenticatedProfileService } from "@/lib/supabase/adminApi";
import {
  deleteHomeMessageFromSupabase,
  loadHomeMessagesFromSupabase,
  persistHomeMessageToSupabase,
} from "@/lib/supabase/homeMessages";
import { canManageMaster } from "@/lib/shift/permissions";

/** ホームメッセージ一覧（service role 経由） */
export async function GET() {
  const auth = await requireAuthenticatedProfileService();
  if (!auth.ok) return auth.response;

  try {
    const { data: departments, error: deptError } = await auth.service
      .from("departments")
      .select("id, name");
    if (deptError) throw deptError;

    const departmentNameById = Object.fromEntries((departments ?? []).map((d) => [d.id, d.name]));
    const messages = await loadHomeMessagesFromSupabase(auth.service, departmentNameById);
    return NextResponse.json({ ok: true, messages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "メッセージの取得に失敗しました。";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}

type CreateMessageBody = {
  body?: string;
  audience?: "all" | "team";
  team?: string;
};

/** ホームメッセージ作成 */
export async function POST(request: Request) {
  const auth = await requireAuthenticatedProfileService();
  if (!auth.ok) return auth.response;

  if (auth.role !== "admin" || !canManageMaster(auth.adminPermission)) {
    return NextResponse.json(
      { ok: false, message: "メッセージの送信はマネージャーまたはアルバイト管理者のみ可能です。" },
      { status: 403 }
    );
  }

  const body = (await request.json()) as CreateMessageBody;
  const text = body.body?.trim() ?? "";
  const audience = body.audience === "team" ? "team" : "all";

  if (!text) {
    return NextResponse.json({ ok: false, message: "メッセージを入力してください。" }, { status: 400 });
  }

  try {
    const { data: departments, error: deptError } = await auth.service.from("departments").select("id, name");
    if (deptError) throw deptError;

    const departmentIdByName = Object.fromEntries((departments ?? []).map((d) => [d.name, d.id]));
    const result = await persistHomeMessageToSupabase(
      auth.service,
      { body: text, audience, team: body.team },
      auth.profileId,
      departmentIdByName
    );
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    const message = error instanceof Error ? error.message : "メッセージの保存に失敗しました。";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}

type DeleteMessageBody = {
  id?: string;
};

/** ホームメッセージ削除 */
export async function DELETE(request: Request) {
  const auth = await requireAuthenticatedProfileService();
  if (!auth.ok) return auth.response;

  if (auth.role !== "admin" || !canManageMaster(auth.adminPermission)) {
    return NextResponse.json(
      { ok: false, message: "メッセージの削除はマネージャーまたはアルバイト管理者のみ可能です。" },
      { status: 403 }
    );
  }

  const body = (await request.json()) as DeleteMessageBody;
  const messageId = body.id?.trim() ?? "";
  if (!messageId) {
    return NextResponse.json({ ok: false, message: "削除対象の ID が必要です。" }, { status: 400 });
  }

  try {
    const result = await deleteHomeMessageFromSupabase(auth.service, messageId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.message }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "メッセージの削除に失敗しました。";
    return NextResponse.json({ ok: false, message }, { status: 400 });
  }
}
