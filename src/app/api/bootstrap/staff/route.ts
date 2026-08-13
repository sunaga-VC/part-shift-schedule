import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/supabase/adminApi";
import { createClient } from "@/lib/supabase/server";
import { loadStaffBootstrapFromService } from "@/lib/supabase/staff";

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

    const bootstrap = await loadStaffBootstrapFromService(service, authUserId, email);
    if (!bootstrap) {
      return NextResponse.json(
        {
          ok: false,
          message:
            "staff_profiles にこのユーザーの行がありません。マスタ管理で登録したログインメールと Auth のメールが一致しているか確認してください。",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({ ok: true, bootstrap });
  } catch (error) {
    const message = error instanceof Error ? error.message : "プロフィール取得に失敗しました。";
    console.error("bootstrap/staff failed", error);
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
