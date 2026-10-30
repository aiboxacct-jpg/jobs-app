"use client";

import { useEffect, useState } from "react";
import { getBrowserClient } from "../../../lib/supabase-browser";

// Magic-link landing page. supabase-js handles the implicit (hash) flow
// automatically; PKCE links arrive with ?code= and need an explicit
// exchange. Handle both, then go home.
export default function AuthCallbackPage() {
  const [message, setMessage] = useState("Signing you in…");

  useEffect(() => {
    (async () => {
      try {
        const supabase = getBrowserClient();
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        }
        const { data } = await supabase.auth.getSession();
        if (data?.session) {
          window.location.replace("/");
          return;
        }
        // Hash-flow tokens may land a tick later via the auth listener.
        const { data: sub } = supabase.auth.onAuthStateChange(
          (_event, session) => {
            if (session) {
              sub.subscription.unsubscribe();
              window.location.replace("/");
            }
          }
        );
        setTimeout(() => {
          setMessage(
            "That sign-in link didn't complete. Request a fresh link and try again."
          );
        }, 6000);
      } catch (err) {
        setMessage(`Sign-in failed: ${String(err?.message || err)}`);
      }
    })();
  }, []);

  return (
    <main className="login-wrap">
      <div className="login-card">
        <h1>Jobs</h1>
        <p className="muted">{message}</p>
        <p>
          <a href="/login">Back to sign-in</a>
        </p>
      </div>
    </main>
  );
}
