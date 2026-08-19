import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getServiceClient, resolveStaffProfileForAuthUser } from "@/lib/supabase/adminApi";

function getSupabaseKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    ""
  );
}

function isAuthSessionError(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  const message = error.message ?? "";
  return (
    code === "refresh_token_not_found" ||
    code === "session_not_found" ||
    message.includes("Refresh Token") ||
    message.includes("refresh_token")
  );
}

/** 無効になった Auth Cookie を消す */
function clearAuthCookies(request: NextRequest, response: NextResponse) {
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-") || cookie.name.includes("supabase")) {
      response.cookies.set(cookie.name, "", {
        path: "/",
        maxAge: 0,
      });
    }
  }
}

function redirectTo(request: NextRequest, pathname: string, clearCookies = false) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = pathname;
  redirectUrl.search = "";
  const response = NextResponse.redirect(redirectUrl);
  if (clearCookies) {
    clearAuthCookies(request, response);
  }
  return response;
}

function redirectToLogin(
  request: NextRequest,
  pathname: string,
  clearCookies = false,
  error?: "profile" | "config"
) {
  const redirectUrl = request.nextUrl.clone();
  redirectUrl.pathname = "/login";
  redirectUrl.searchParams.set("next", pathname);
  if (error) {
    redirectUrl.searchParams.set("error", error);
  }
  const response = NextResponse.redirect(redirectUrl);
  if (clearCookies) {
    clearAuthCookies(request, response);
  }
  return response;
}

function isApiRoute(pathname: string) {
  return pathname.startsWith("/api/");
}

function apiJsonError(status: number, message: string, request?: NextRequest, clearCookies = false) {
  const response = NextResponse.json({ ok: false, message }, { status });
  if (clearCookies && request) {
    clearAuthCookies(request, response);
  }
  return response;
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const pathname = request.nextUrl.pathname;
  if (pathname.startsWith("/api/dev/")) {
    return supabaseResponse;
  }
  if (pathname.startsWith("/api/health/")) {
    return supabaseResponse;
  }
  const isLoginPage = pathname === "/login";
  const isLoginApi = pathname === "/api/login";
  const isPublicAsset =
    pathname.startsWith("/_next") || pathname.startsWith("/favicon") || pathname.includes(".");

  if (isPublicAsset) {
    return supabaseResponse;
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = getSupabaseKey();
  // 本番で env 未設定のときはログイン必須（Supabase 未設定では API 保護のみ）
  if (!url || !key) {
    if (process.env.NODE_ENV === "production" && !isLoginPage) {
      if (isApiRoute(pathname)) {
        return apiJsonError(500, "Supabase の環境変数が設定されていません。");
      }
      return redirectToLogin(request, pathname);
    }
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user: cookieUser },
    error,
  } = await supabase.auth.getUser();

  let user = cookieUser;
  if (!user && isApiRoute(pathname)) {
    const raw = request.headers.get("authorization") ?? "";
    const token = raw.toLowerCase().startsWith("bearer ") ? raw.slice(7).trim() : "";
    if (token) {
      const tokenResult = await supabase.auth.getUser(token);
      user = tokenResult.data.user ?? null;
    }
  }

  if (!user && isAuthSessionError(error)) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignore
    }
    if (!isLoginPage) {
      if (isApiRoute(pathname)) {
        return apiJsonError(401, "ログインセッションが無効です。再度ログインしてください。", request, true);
      }
      return redirectToLogin(request, pathname, true);
    }
    clearAuthCookies(request, supabaseResponse);
    return supabaseResponse;
  }

  const isLoggedIn = Boolean(user);

  // ログイン画面・ログイン API は未ログインでも利用可
  if (isLoginPage || isLoginApi) {
    return supabaseResponse;
  }

  if (!isLoggedIn) {
    if (isApiRoute(pathname)) {
      return apiJsonError(401, "ログインが必要です。");
    }
    return redirectToLogin(request, pathname);
  }

  // API は各 route 側で権限チェックするため、middleware ではセッション確認のみ（DB 照会を省略）
  if (isApiRoute(pathname)) {
    return supabaseResponse;
  }

  const userEmail = user?.email?.trim().toLowerCase();
  if (!userEmail) {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignore
    }
    if (isApiRoute(pathname)) {
      return apiJsonError(401, "メールアドレスが見つかりません。", request, true);
    }
    return redirectToLogin(request, pathname, true);
  }

  // 権限チェック（staff_profiles.role）
  const service = getServiceClient();
  const profile = service && user?.id
    ? await resolveStaffProfileForAuthUser(service, user.id, userEmail)
    : null;

  if (!profile || profile.status !== "active") {
    try {
      await supabase.auth.signOut({ scope: "local" });
    } catch {
      // ignore
    }
    if (isApiRoute(pathname)) {
      return apiJsonError(403, "有効なスタッフプロフィールが見つかりません。", request, true);
    }
    return redirectToLogin(request, pathname, true, "profile");
  }

  const isAdmin = profile.role === "admin";
  const canAccessMaster =
    isAdmin && (profile.admin_permission === "manager" || profile.admin_permission === "part_time_admin");
  const isAdminRoute = pathname.startsWith("/admin");
  const isMasterRoute = pathname.startsWith("/admin/master");

  // スタッフ（worker）はホーム・管理者画面に入れない（シフト画面へ）
  if (!isAdmin && (pathname === "/" || isAdminRoute)) {
    if (isApiRoute(pathname)) {
      return apiJsonError(403, "管理者権限が必要です。");
    }
    return redirectTo(request, "/shift");
  }

  // 一般管理者はマスタ管理に入れない（アルバイト管理者は可）
  if (isAdmin && !canAccessMaster && isMasterRoute) {
    if (isApiRoute(pathname)) {
      return apiJsonError(403, "マスタ管理の権限が必要です。");
    }
    return redirectTo(request, "/admin/board");
  }

  return supabaseResponse;
}
