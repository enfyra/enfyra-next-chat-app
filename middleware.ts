import { NextResponse, type NextRequest } from "next/server";

const protectedMatchers = ["/", "/chat"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const shouldGuard = protectedMatchers.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!shouldGuard) return NextResponse.next();

  const userResponse = await fetch(new URL("/enfyra/me", request.url), {
    headers: {
      cookie: request.headers.get("cookie") || "",
      accept: "application/json",
    },
    cache: "no-store",
  }).catch(() => null);
  const authenticated = Boolean(userResponse?.ok);

  if (pathname === "/") {
    const response = NextResponse.redirect(new URL(authenticated ? "/chat" : "/login", request.url));
    copySetCookie(userResponse, response);
    return response;
  }

  if (!authenticated) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const response = NextResponse.next();
  copySetCookie(userResponse, response);
  return response;
}

function copySetCookie(source: Response | null, target: NextResponse) {
  const headers = source?.headers as (Headers & { getSetCookie?: () => string[] }) | undefined;
  const cookies = headers?.getSetCookie?.() || [];
  const fallback = headers?.get("set-cookie");

  for (const cookie of cookies.length ? cookies : fallback ? [fallback] : []) {
    target.headers.append("set-cookie", cookie);
  }
}

export const config = {
  matcher: ["/", "/chat/:path*"],
};
