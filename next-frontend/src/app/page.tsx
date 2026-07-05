"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardBody, Input, Label, Button, Alert } from "@/components/ui";

export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8003"}/api/v1/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      if (!res.ok) {
        throw new Error("Invalid credentials");
      }

      const data = await res.json();
      localStorage.setItem("user_role", data.role);
      if (data.access_token) {
        localStorage.setItem("jwt_token", data.access_token);
      }
      router.push("/dashboard");
    } catch (err: any) {
      setError(err.message || "An error occurred");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink p-4">
      <Card className="w-full max-w-md">
        <CardBody className="gap-6 p-8">
          <div className="text-center">
            <h1 className="font-display text-3xl font-extrabold uppercase tracking-wide text-ink">EJ Tracker</h1>
            <p className="text-ink-soft">System Authentication</p>
          </div>

          <form onSubmit={handleLogin} className="flex flex-col gap-5">
            <div>
              <Label>User ID</Label>
              <Input type="text" required placeholder="Enter your User ID" value={username} onChange={(e) => setUsername(e.target.value)} />
            </div>

            <div>
              <Label>Password</Label>
              <Input
                type="password"
                required
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            {error && (
              <Alert tone="critical" title="Sign-in failed">
                {error}
              </Alert>
            )}

            <Button type="submit" disabled={loading} className="w-full justify-center">
              {loading ? "Authenticating…" : "Sign In"}
            </Button>
          </form>
        </CardBody>
      </Card>
    </div>
  );
}
