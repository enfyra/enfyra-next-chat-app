import { NextResponse, type NextRequest } from "next/server";
import { enfyraConfig } from "./lib/enfyra-config";

const protectedMatchers = ["/", "/chat"];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const publicOrigin = getPublicOrigin(request);
  const shouldGuard = protectedMatchers.some((path) => pathname === path || pathname.startsWith(`${path}/`));

  if (!shouldGuard) return NextResponse.next();

  const userResponse = await fetch(new URL("/me", enfyraConfig.enfyraApiUrl), {
    headers: {
      cookie: request.headers.get("cookie") || "",
      accept: "application/json",
    },
    cache: "no-store",
  }).catch(() => null);
  const authenticated = Boolean(userResponse?.ok);

  if (pathname === "/") {
    const response = NextResponse.redirect(`${publicOrigin}${authenticated ? "/chat" : "/login"}`);
    copySetCookie(userResponse, response);
    return response;
  }

  if (!authenticated) {
    return NextResponse.redirect(`${publicOrigin}/login`);
  }

  const response = NextResponse.next();
  copySetCookie(userResponse, response);
  return response;
}

function getPublicOrigin(request: NextRequest) {
  const forwardedHost = normalizeForwardedHost(request.headers.get("x-forwarded-host") || request.headers.get("host"));
  const forwardedProto = firstForwardedValue(request.headers.get("x-forwarded-proto"));
  const fallbackUrl = new URL(request.url);
  const protocol = forwardedProto || fallbackUrl.protocol.replace(":", "");
  const host = forwardedHost || fallbackUrl.host;

  return `${protocol}://${host}`;
}

function firstForwardedValue(value: string | null) {
  return value?.split(",")[0]?.trim() || "";
}

function normalizeForwardedHost(value: string | null) {
  const host = firstForwardedValue(value);
  if (!host) return "";

  const url = host.includes("://") ? new URL(host) : new URL(`http://${host}`);
  const hostname = url.hostname;
  const port = url.port;

  if (!port || hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return host;
  }

  return hostname;
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
