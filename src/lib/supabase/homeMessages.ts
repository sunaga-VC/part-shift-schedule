import type { createClient } from "@/lib/supabase/client";
import type { HomeMessage } from "@/lib/shift/types";

type SupabaseClient = ReturnType<typeof createClient>;

export async function loadHomeMessagesFromSupabase(
  supabase: SupabaseClient,
  departmentNameById: Record<string, string>
): Promise<HomeMessage[]> {
  const { data, error } = await supabase
    .from("home_messages")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    createdByStaffId: row.created_by,
    audience: row.audience === "team" ? "team" : "all",
    team: row.department_id ? departmentNameById[row.department_id] ?? "" : "",
  }));
}

export async function persistHomeMessageToSupabase(
  supabase: SupabaseClient,
  input: { body: string; audience: "all" | "team"; team?: string },
  createdByStaffId: string,
  departmentIdByName: Record<string, string>
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const body = input.body.trim();
  if (!body) {
    return { ok: false, message: "メッセージを入力してください。" };
  }

  let departmentId: string | null = null;
  if (input.audience === "team") {
    const team = input.team?.trim() ?? "";
    if (!team) {
      return { ok: false, message: "所属を選択してください。" };
    }
    departmentId = departmentIdByName[team] ?? null;
    if (!departmentId) {
      return { ok: false, message: `所属「${team}」が見つかりません。` };
    }
  }

  const { data, error } = await supabase
    .from("home_messages")
    .insert({
      body,
      created_by: createdByStaffId,
      audience: input.audience,
      department_id: departmentId,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, message: error?.message || "メッセージの保存に失敗しました。" };
  }

  return { ok: true, id: data.id };
}

export async function deleteHomeMessageFromSupabase(
  supabase: SupabaseClient,
  messageId: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  const { error } = await supabase.from("home_messages").delete().eq("id", messageId);
  if (error) {
    return { ok: false, message: error.message || "メッセージの削除に失敗しました。" };
  }
  return { ok: true };
}
