"use client";

import { createClient } from "@supabase/supabase-js";

let client = null;

// Browser Supabase client (anon key). Only used for Auth (magic link);
// all job data flows through the server API routes with the session
// access token as a Bearer header. Sessions are supabase-js defaults:
// persisted in localStorage and auto-refreshed (long-lived sign-in).
export function getBrowserClient() {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Legacy name: NEXT_PUBLIC_SUPABASE_ANON_KEY. The Vercel–Supabase
  // integration injects the new-style publishable key as
  // NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — accept both.
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) are not set");
  }
  client = createClient(url, anon);
  return client;
}
