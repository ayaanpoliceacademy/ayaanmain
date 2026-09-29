import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public health check — reports env presence (booleans only, NO secrets),
// DB URL *shape* (host/port/encoding flags, NO userinfo), and DB
// reachability with Prisma error code. Safe to expose.
function urlShape(raw: string | undefined) {
  if (!raw) return { present: false };
  const trimmed = raw.trim();
  const hadKeyPrefix = /^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|POSTGRES_PRISMA_URL)\s*=/i.test(trimmed);
  const hadWhitespace = /\s/.test(trimmed);
  const v = trimmed
    .replace(/^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|POSTGRES_PRISMA_URL)\s*=\s*/i, "")
    .replace(/^["']|["']$/g, "")
    .replace(/\s+/g, "");
  const qi = v.indexOf("?");
  const head = qi >= 0 ? v.slice(0, qi) : v;
  const tail = qi >= 0 ? v.slice(qi + 1) : "";
  // groups: 1=auth, 2=host, 3=port-full, 4=port digits, 5=path
  const m = head.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^@/]*@)?([^/:?#]+)(:(\d+))?(\/.*)?$/);
  const auth = (m && m[1] ? m[1].slice(0, -1) : "");
  const user = auth.includes(":") ? auth.slice(0, auth.indexOf(":")) : auth; // username only, never password
  let authHasRawAt = false;
  try {
    const pass = auth.includes(":") ? auth.slice(auth.indexOf(":") + 1) : auth;
    authHasRawAt = pass.includes("@") || /%(?![0-9A-Fa-f]{2})/.test(pass);
  } catch { authHasRawAt = true; }
  const host = (m && m[2]) || null;
  const port = (m && m[4]) || null;
  return {
    present: true,
    hadKeyPrefix,
    hadWhitespace,
    quoted: v !== trimmed,
    hasPlaceholders: /[<>]/.test(v),
    user: user || null,
    host,
    port,
    pooler: !!((host && host.includes("pooler")) || tail.includes("pgbouncer=true")),
    questionMarks: (v.match(/\?/g) || []).length,
    authHasRawSpecials: authHasRawAt,
    params: tail ? tail.split("&").map((p) => p.split("=")[0]) : [],
  };
}

export async function GET() {
  const env = {
    databaseUrl: !!process.env.DATABASE_URL,
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const shape = urlShape(process.env.DATABASE_URL);
  let db: { reachable: boolean; code?: string | null; messagePreview?: string; hint?: string } = { reachable: false };
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    db = { reachable: true };
  } catch (e: any) {
    const code = e?.code ?? e?.errorCode ?? null;
    const messagePreview = String(e?.message || e).replace(/\s+/g, " ").slice(0, 220);
    const hints: Record<string, string> = {
      P1000: "auth failed — wrong DB password or wrong pooler username (must be postgres.<ref>)",
      P1001: "can't reach DB host — use Supabase pooler :6543 URI, not direct :5432",
      P1017: "connection closed — pooler recommended for serverless",
    };
    db = { reachable: false, code, messagePreview, hint: (code && hints[code]) || "check DATABASE_URL value + redeploy" };
  }
  const ok = env.databaseUrl && env.supabaseUrl && env.anonKey && env.serviceKey && db.reachable;
  return NextResponse.json({ ok, env, shape, db }, { status: ok ? 200 : 500 });
}
