import { createServerClient } from "@supabase/ssr";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const AUTH_PATHS = [
  "/auth/login",
  "/auth/register",
  "/auth/forgot-password",
];

const ALWAYS_PUBLIC_PATHS = [
  "/auth/callback",
  "/auth/reset-password",
  "/monitor",
  "/terms",
  "/privacy",
  "/manifest.json",
  "/apple-icon",
];

const ALWAYS_PUBLIC_PREFIXES = ["/icons/"];

export async function middleware(req: NextRequest) {
  let response = NextResponse.next({ request: req });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return req.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => req.cookies.set(name, value));
          response = NextResponse.next({ request: req });
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
          });
        },
      },
    }
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isAuthPath = AUTH_PATHS.includes(req.nextUrl.pathname);
  const isAlwaysPublicPath = ALWAYS_PUBLIC_PATHS.some((path) =>
    path === "/auth/callback"
      ? req.nextUrl.pathname.startsWith(path)
      : req.nextUrl.pathname === path
  ) || ALWAYS_PUBLIC_PREFIXES.some((path) => req.nextUrl.pathname.startsWith(path));
  const isPublicPath = isAuthPath || isAlwaysPublicPath;

  if (!user && !isPublicPath) {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set(
      "next",
      `${req.nextUrl.pathname}${req.nextUrl.search}`
    );
    const redirectResponse = NextResponse.redirect(loginUrl);
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (user && isAuthPath) {
    const redirectResponse = NextResponse.redirect(new URL("/", req.url));
    response.cookies.getAll().forEach((cookie) => redirectResponse.cookies.set(cookie));
    return redirectResponse;
  }

  if (!isAlwaysPublicPath) {
    response.headers.set("Cache-Control", "private, no-store, max-age=0");
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
