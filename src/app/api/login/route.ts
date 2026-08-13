import { NextResponse } from "next/server";
import { performLogin } from "@/lib/auth/login";

type LoginBody = {
  email?: string;
  password?: string;
  next?: string;
};

export async function POST(request: Request) {
  let body: LoginBody;
  try {
    body = (await request.json()) as LoginBody;
  } catch {
    return NextResponse.json({ ok: false, error: "リクエスト形式が不正です。" }, { status: 400 });
  }

  const result = await performLogin({
    email: String(body.email ?? ""),
    password: String(body.password ?? ""),
    next: body.next,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 401 });
  }

  return NextResponse.json({ ok: true, redirectTo: result.redirectTo });
}
