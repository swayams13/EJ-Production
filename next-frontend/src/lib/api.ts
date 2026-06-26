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
  
  // Cache busting query parameter
  const separator = url.includes("?") ? "&" : "?";
  const liveUrl = `${url}${separator}t=${new Date().getTime()}`;
  
  const response = await fetch(liveUrl, config);
  
  if (response.status === 401) {
    // Optional: handle token expiration by redirecting to login
    localStorage.removeItem("jwt_token");
    window.location.href = "/login";
  }
  
  return response;
};
