import { NextResponse } from "next/server";
import { requireAuthenticatedProfileService } from "@/lib/supabase/adminApi";
import { loadAppBootstrapForAuth } from "@/lib/supabase/appBootstrap";

/** 初回読み込み用: スタッフ・シフト・お知らせをまとめて返す */
export async function GET() {
  const auth = await requireAuthenticatedProfileService();
  if (!auth.ok) return auth.response;

  try {
    const payload = await loadAppBootstrapForAuth(auth);
    if (!payload) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "staff_profiles にこのユーザーの行がありません。マスタ管理で登録したログインメールと Auth のメールが一致しているか確認してください。",
        },
        { status: 404 }
      );
    }
    return NextResponse.json({ ok: true, ...payload });
  } catch (error) {
    const message = error instanceof Error ? error.message : "アプリデータの取得に失敗しました。";
    console.error("bootstrap/app failed", error);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
