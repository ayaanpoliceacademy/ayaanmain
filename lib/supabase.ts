import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

const missing = [
  !supabaseUrl && "NEXT_PUBLIC_SUPABASE_URL",
  !supabaseAnonKey && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  !supabaseServiceKey && "SUPABASE_SERVICE_ROLE_KEY",
].filter(Boolean) as string[];
if (missing.length > 0) {
  throw new Error(
    `Missing Supabase env vars: ${missing.join(", ")} — set them in Vercel Project → Settings → Environment Variables (Production + Preview + Development), then Redeploy.`
  );
}

// Critical guard: never ship service_role to the browser in production
if (process.env.NODE_ENV === "production" && supabaseAnonKey === supabaseServiceKey) {
  throw new Error(
    "CRITICAL: NEXT_PUBLIC_SUPABASE_ANON_KEY matches SUPABASE_SERVICE_ROLE_KEY — service_role would be exposed to browsers. Set the correct anon public key from Supabase Dashboard → Project Settings → API."
  );
}

// Server-side auth client — uses service_role (server-only, never bundled to client)
// NOTE: anon placeholder in .env is not yet set; service_role is required for signInWithPassword server-side
// Guard above ensures prod anon !== service; once anon is set, switch this to anonKey for RLS
const serverAuthKey = supabaseServiceKey;
export const supabase = createClient(supabaseUrl, serverAuthKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Admin client for server-side operations (createUser, verify, etc.)
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Helper to get email from username for admins (username -> email)
export function usernameToEmail(username: string): string {
  const map: Record<string, string> = {
    admin: "admin@ayaaninstitute.in",
    finance: "finance@ayaaninstitute.in",
    admissions: "admissions@ayaaninstitute.in",
  };
  if (map[username]) return map[username];
  // if already email, return as is
  if (username.includes("@")) return username.toLowerCase();
  return `${username}@ayaaninstitute.in`;
}
