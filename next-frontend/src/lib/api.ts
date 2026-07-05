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

  if (response.status === 401) {
    // Optional: handle token expiration by redirecting to login
    localStorage.removeItem("jwt_token");
    window.location.href = "/login";
  }

  return response;
};
