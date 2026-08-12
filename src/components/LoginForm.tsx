"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError(signInError.message === "Invalid login credentials"
          ? "メールまたはパスワードが正しくありません。"
          : signInError.message);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("ログインに失敗しました。");
        return;
      }

      const { data: profile, error: profileError } = await supabase
        .from("staff_profiles")
        .select("id, last_name, role, admin_permission, status")
        .eq("id", user.id)
        .maybeSingle();

      if (profileError) {
        setError(`プロフィール取得に失敗しました: ${profileError.message}`);
        return;
      }
      if (!profile) {
        setError("staff_profiles にこのユーザーの行がありません。");
        return;
      }
      if (profile.status !== "active") {
        setError("このアカウントは無効です。");
        await supabase.auth.signOut();
        return;
      }

      const next = searchParams.get("next") || "/";
      router.replace(next);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ログインに失敗しました。");
    } finally {
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
      {error ? <p className="badge warn" style={{ margin: 0 }}>{error}</p> : null}
      <button type="submit" className="btn primary btn-action-green" disabled={loading}>
        {loading ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
