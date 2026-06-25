export const fetchWithAuth = async (url: string, options: RequestInit = {}) => {
  const token = localStorage.getItem("mes_token");
  
  const headers = {
    ...options.headers,
    "Authorization": token ? `Bearer ${token}` : "",
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    // If token is invalid or expired, log them out
    localStorage.removeItem("mes_token");
    localStorage.removeItem("mes_user");
    window.location.href = "/login";
  }

  return response;
};
