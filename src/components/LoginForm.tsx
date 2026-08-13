"use client";

import { useSearchParams } from "next/navigation";
import { useActionState, useState } from "react";
import { loginAction, type LoginActionState } from "@/app/login/actions";

function initialError(searchParams: URLSearchParams): string | null {
  const code = searchParams.get("error");
  if (code === "config") {
    return "Supabase の環境変数が Vercel に設定されていません。NEXT_PUBLIC_SUPABASE_URL / ANON_KEY を追加して再デプロイしてください。";
  }
  if (code === "profile") {
    return "前回のログインでスタッフ情報と紐づけられませんでした。正しいメールアドレスで再度お試しください。";
  }
  return null;
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [queryError] = useState(() => initialError(searchParams));
  const [state, formAction, pending] = useActionState<LoginActionState | null, FormData>(
    loginAction,
    queryError ? { error: queryError } : null
  );

  const error = state?.error ?? null;

  return (
    <form className="login-form stack" action={formAction}>
      <input type="hidden" name="next" value={searchParams.get("next") ?? ""} />
      <label>
        メールアドレス
        <input
          type="email"
          name="email"
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
          name="password"
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
      <button type="submit" className="btn primary btn-action-green" disabled={pending}>
        {pending ? "ログイン中..." : "ログイン"}
      </button>
    </form>
  );
}
