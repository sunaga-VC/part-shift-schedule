import { Suspense } from "react";
import { LoginForm } from "@/components/LoginForm";

export default function LoginPage() {
  return (
    <main className="login-page">
      <section className="panel login-card stack">
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>シフト調整アプリ</h1>
        </div>
        <Suspense fallback={<p className="muted">読み込み中...</p>}>
          <LoginForm />
        </Suspense>
      </section>
    </main>
  );
}
