"use client";

import { useState } from "react";
import { getBrowserClient } from "../../lib/supabase-browser";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState("idle"); // idle | sending | sent | error
  const [error, setError] = useState("");

  async function submit(e) {
    e.preventDefault();
    setState("sending");
    setError("");
    try {
      const supabase = getBrowserClient();
      const siteUrl =
        process.env.NEXT_PUBLIC_SITE_URL || window.location.origin;
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: `${siteUrl}/auth/callback` },
      });
      if (error) throw error;
      setState("sent");
    } catch (err) {
      setError(String(err?.message || err));
      setState("error");
    }
  }

  return (
    <main className="login-wrap">
      <div className="login-card">
        <h1>Jobs</h1>
        <p className="muted">
          Matt Myrtle&rsquo;s job pipeline. Sign in with a one-time email
          link — no password.
        </p>
        {state === "sent" ? (
          <p className="login-sent">
            ✓ Link sent. Check your email and click the sign-in link — on
            this device you&rsquo;ll stay signed in.
          </p>
        ) : (
          <form onSubmit={submit}>
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
            <button type="submit" disabled={state === "sending"}>
              {state === "sending" ? "Sending…" : "Email me a sign-in link"}
            </button>
            {state === "error" && <p className="login-error">{error}</p>}
          </form>
        )}
      </div>
    </main>
  );
}
