export class ApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as { ok: boolean; data?: T; error?: string };
  if (!json.ok) throw new ApiError(json.error || "요청에 실패했습니다.");
  return json.data as T;
}

export function originFromWindow() {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}
