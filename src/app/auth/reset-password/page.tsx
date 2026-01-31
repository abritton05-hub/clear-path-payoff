"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function ResetPasswordPage() {
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (!active) return;
        if (sessionError) {
          setHasSession(false);
        } else {
          setHasSession(Boolean(data.session?.user));
        }
      } catch {
        if (!active) return;
        setHasSession(false);
      } finally {
        if (!active) return;
        setChecking(false);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!password || password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }

    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Password updated. You can sign in now.");
    setPassword("");
  }

  return (
    <main style={{ padding: "40px 16px", maxWidth: 520, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>Reset your password</h1>

      {checking ? (
        <p>Checking your reset link...</p>
      ) : !hasSession ? (
        <div>
          <p style={{ marginBottom: 16 }}>Invalid or expired link.</p>
          <a href="/" style={{ fontWeight: 700, color: "#1d4ed8" }}>
            Back to login
          </a>
        </div>
      ) : (
        <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
          <label style={{ fontWeight: 700 }}>
            New password
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              type="password"
              style={{
                display: "block",
                width: "100%",
                marginTop: 6,
                padding: "10px 12px",
                borderRadius: 10,
                border: "1px solid rgba(0,0,0,0.2)",
              }}
            />
          </label>
          <button
            type="submit"
            style={{
              padding: "10px 12px",
              borderRadius: 10,
              border: "1px solid rgba(0,0,0,0.2)",
              background: "#e5f3ff",
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Update password
          </button>
          {message && <div style={{ color: "#166534", fontWeight: 700 }}>{message}</div>}
          {error && <div style={{ color: "#b91c1c", fontWeight: 700 }}>{error}</div>}
        </form>
      )}
    </main>
  );
}
