import { jwtVerify } from "jose";

export const ADMIN_ACCESS_COOKIE_NAME = "admin_access_token";
export const ADMIN_REFRESH_COOKIE_NAME = "admin_refresh_token";
export const ADMIN_ALLOWED_ROLES = new Set(["super_admin", "admin", "analyst", "viewer"]);
export const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type RefreshEnvelope = {
  success?: boolean;
  data?: {
    accessToken?: string;
    refreshToken?: string;
  };
};

function getJwtSecret(): Uint8Array {
  const secret = process.env.JWT_ACCESS_SECRET ?? "change_me_access";
  if (!process.env.JWT_ACCESS_SECRET && process.env.NODE_ENV === "production") {
    throw new Error("JWT_ACCESS_SECRET is required for admin-web auth");
  }
  return new TextEncoder().encode(secret);
}

export async function validateAdminAccessToken(token?: string) {
  if (!token) {
    return { ok: false as const };
  }

  try {
    const { payload } = await jwtVerify(token, getJwtSecret());
    const role = typeof payload.role === "string" ? payload.role : "";
    if (!ADMIN_ALLOWED_ROLES.has(role)) {
      return { ok: false as const };
    }
    return { ok: true as const, role };
  } catch {
    return { ok: false as const };
  }
}

export async function refreshAdminTokens(refreshToken?: string) {
  if (!refreshToken) {
    return null;
  }

  const response = await fetch(`${INTERNAL_API_URL}/api/v1/auth/refresh`, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({ refreshToken }),
    cache: "no-store"
  });

  if (!response.ok) {
    return null;
  }

  let payload: RefreshEnvelope | null = null;
  try {
    payload = (await response.json()) as RefreshEnvelope;
  } catch {
    payload = null;
  }

  if (!payload?.success) {
    return null;
  }

  const accessToken = payload.data?.accessToken;
  const rotatedRefreshToken = payload.data?.refreshToken;
  if (!accessToken || !rotatedRefreshToken) {
    return null;
  }

  const accessValidation = await validateAdminAccessToken(accessToken);
  if (!accessValidation.ok) {
    return null;
  }

  return {
    accessToken,
    refreshToken: rotatedRefreshToken,
    role: accessValidation.role
  };
}

export function isSecureRequest(protocol: string) {
  return process.env.NODE_ENV === "production" && protocol === "https:";
}
