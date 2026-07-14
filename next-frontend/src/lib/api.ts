export class ForbiddenError extends Error {
  status = 403;
  constructor(detail = "You don't have permission to perform this action.") {
    super(detail);
  }
}

export const apiFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem("jwt_token");

  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const config: RequestInit = {
    cache: "no-store",
    ...options,
    headers
  };

  // Cache busting: set (not append) the `t` query param, so a URL that
  // already has one (e.g. a caller added its own timestamp) doesn't end up
  // with a duplicate `?t=...&t=...` pair.
  const urlObj = new URL(url, window.location.origin);
  urlObj.searchParams.set("t", Date.now().toString());
  const liveUrl = urlObj.toString();

  let response: Response;
  try {
    response = await fetch(liveUrl, config);
  } catch (err) {
    throw new Error(`Network request to ${url} failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (response.status === 401 && !url.includes("/auth/refresh")) {
    const refreshToken = localStorage.getItem("refresh_token");
    if (refreshToken) {
      const apiBase = url.startsWith("http") ? new URL(url).origin : window.location.origin;
      const refreshRes = await fetch(`${apiBase}/api/v1/auth/refresh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
        cache: "no-store",
      }).catch(() => null);
      if (refreshRes?.ok) {
        const { access_token } = await refreshRes.json();
        localStorage.setItem("jwt_token", access_token);
        headers.set("Authorization", `Bearer ${access_token}`);
        return fetch(liveUrl, { ...config, headers });
      }
    }
    localStorage.removeItem("jwt_token");
    localStorage.removeItem("refresh_token");
    window.location.href = "/login";
  }

  if (response.status === 403) {
    const body = await response.json().catch(() => ({})) as { detail?: string };
    throw new ForbiddenError(body.detail);
  }

  return response;
};
