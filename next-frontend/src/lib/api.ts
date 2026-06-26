export const apiFetch = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem("jwt_token");
  
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  
  const config = {
    ...options,
    headers
  };
  
  const response = await fetch(url, config);
  
  if (response.status === 401) {
    // Optional: handle token expiration by redirecting to login
    localStorage.removeItem("jwt_token");
    window.location.href = "/login";
  }
  
  return response;
};
