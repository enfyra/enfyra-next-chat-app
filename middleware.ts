import { NextResponse, type NextRequest } from "next/server";

const protectedMatchers = ["/", "/chat"];

export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicUrl = getPublicUrl(request);
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
    const response = NextResponse.redirect(new URL(authenticated ? "/chat" : "/login", publicUrl));
    copySetCookie(userResponse, response);
    return response;
  }

  if (!authenticated) {
    return NextResponse.redirect(new URL("/login", publicUrl));
  }

  const response = NextResponse.next();
  copySetCookie(userResponse, response);
  return response;
}

function getPublicUrl(request: NextRequest) {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  const forwardedProto = request.headers.get("x-forwarded-proto");

  if (forwardedHost) url.host = forwardedHost;
  if (forwardedProto) url.protocol = `${forwardedProto}:`;

  return url;
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
