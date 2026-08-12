"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() =>
    searchParams.get("error") === "config"
      ? "Supabase の環境変数が Vercel に設定されていません。NEXT_PUBLIC_SUPABASE_URL / ANON_KEY を追加して再デプロイしてください。"
      : null
  );
  const [loading, setLoading] = useState(false);

  // 失効した refresh token / 前セッションを掃除してから入力できるようにする
  useEffect(() => {
    void (async () => {
      try {
        const supabase = createClient();
        // ログイン画面では常に前のセッションを切る（別アカウントで入れない問題の防止）
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // ignore
      }
    })();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      // 念のため再ログアウトしてからログイン
      await supabase.auth.signOut({ scope: "local" });

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "メールまたはパスワードが正しくありません。"
            : signInError.message
        );
        setLoading(false);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("ログインに失敗しました。");
        setLoading(false);
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("staff_profiles")
        .select("id, last_name, role, admin_permission, status")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        setError(`プロフィール取得に失敗しました: ${profileError.message}`);
        setLoading(false);
        return;
      }
      if (!profile) {
        setError("staff_profiles にこのユーザーの行がありません。");
        setLoading(false);
        return;
      }
      if (profile.status !== "active") {
        setError("このアカウントは無効です。");
        await supabase.auth.signOut();
        setLoading(false);
        return;
      }

      // 権限に応じて遷移先を分ける
      const requestedNext = searchParams.get("next") || "";
      let destination = "/";
      if (profile.role === "admin") {
        const canAccessMaster =
          profile.admin_permission === "manager" || profile.admin_permission === "part_time_admin";
        if (requestedNext.startsWith("/admin/master") && canAccessMaster) {
          destination = requestedNext;
        } else if (requestedNext.startsWith("/admin")) {
          destination = requestedNext;
        } else {
          destination = "/";
        }
      } else {
        // スタッフは管理者URLへは行けない
        if (requestedNext.startsWith("/admin")) {
          destination = "/";
        } else if (requestedNext.startsWith("/")) {
          destination = requestedNext;
        } else {
          destination = "/";
        }
      }

      window.location.href = destination;
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました。");
      setLoading(false);
    }
  };

  return (
    <form className="login-form stack" onSubmit={onSubmit}>
      <label>
        メールアドレス
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
      </label>
      <label>
        パスワード
        <input
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      {error ? (
        <p className="badge warn" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn primary btn-action-green" disabled={loading}>
        {loading ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
