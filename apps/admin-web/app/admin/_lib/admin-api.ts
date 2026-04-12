import { cookies } from "next/headers";

const INTERNAL_API_URL = process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

type Envelope<T> = {
  success: boolean;
  data: T;
  meta: unknown;
  error: unknown;
};

export type AdminApiResult<T> = {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
};

function toErrorMessage(status: number, payload: unknown) {
  const fromPayload =
    payload &&
    typeof payload === "object" &&
    "error" in payload &&
    typeof (payload as { error?: unknown }).error === "string"
      ? ((payload as { error: string }).error as string)
      : null;

  if (fromPayload) {
    return fromPayload;
  }

  if (status === 401 || status === 403) {
    return "Oturum doğrulanamadı. Lütfen yeniden giriş yapın.";
  }

  return `API isteği başarısız (${status})`;
}

export async function adminApiGet<T>(path: string): Promise<AdminApiResult<T>> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("admin_access_token")?.value;

  if (!accessToken) {
    return {
      ok: false,
      status: 401,
      data: null,
      error: "Yönetim oturumu bulunamadı."
    };
  }

  const response = await fetch(`${INTERNAL_API_URL}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`
    },
    cache: "no-store"
  });

  let payload: Envelope<T> | Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Envelope<T> | Record<string, unknown>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: toErrorMessage(response.status, payload)
    };
  }

  if (!payload || typeof payload !== "object" || !("success" in payload)) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: "Beklenen API yanıtı alınamadı."
    };
  }

  const envelope = payload as Envelope<T>;
  if (!envelope.success) {
    return {
      ok: false,
      status: response.status,
      data: null,
      error: toErrorMessage(response.status, envelope)
    };
  }

  return {
    ok: true,
    status: response.status,
    data: envelope.data,
    error: null
  };
}
