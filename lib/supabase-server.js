import { createClient } from "@supabase/supabase-js";

// Server-only Supabase client (service role — bypasses RLS).
// Created lazily inside request handlers so `next build` never crashes
// when env vars are absent at build time.
export function getServiceClient() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  // Legacy name: SUPABASE_SERVICE_ROLE_KEY. The Vercel–Supabase integration
  // injects the new-style secret key as SUPABASE_SECRET_KEY — accept both.
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY) are not set");
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Validate a user access token (magic-link session) via Supabase Auth.
export async function getUserFromToken(token) {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anon || !token) return null;
  const client = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
}
