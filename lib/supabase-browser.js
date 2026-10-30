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
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set");
  }
  client = createClient(url, anon);
  return client;
}
