"use client";

import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { createClient } from "@/lib/supabase/client";
import { normalizeEmailInput } from "@/lib/shift/email";

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

function resolveRedirectPath(next: string | null): string {
  const target = (next ?? "").trim();
  if (target.startsWith("/") && !target.startsWith("//")) {
    return target;
  }
  return "/";
}

export function LoginForm() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(() => initialError(searchParams));
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const normalizedEmail = normalizeEmailInput(email);
    if (!normalizedEmail || !password) {
      setError("メールアドレスとパスワードを入力してください。");
      setPending(false);
      return;
    }

    try {
      const supabase = createClient();
      const signInPromise = supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });
      const timeoutPromise = new Promise<never>((_, reject) => {
        window.setTimeout(() => reject(new Error("timeout")), 15000);
      });

      const { error: signInError } = await Promise.race([signInPromise, timeoutPromise]);

      if (signInError) {
        setError(
          signInError.message === "Invalid login credentials"
            ? "メールまたはパスワードが正しくありません。"
            : signInError.message
        );
        return;
      }

      window.location.assign(resolveRedirectPath(searchParams.get("next")));
    } catch (caught) {
      if (caught instanceof Error && caught.message === "timeout") {
        setError("ログインがタイムアウトしました。dev サーバーを再起動してから再度お試しください。");
        return;
      }
      setError(
        caught instanceof Error && caught.message.includes("環境変数")
          ? caught.message
          : "ログインに失敗しました。ネットワーク接続を確認してください。"
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="login-form stack" onSubmit={(event) => void handleSubmit(event)}>
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
