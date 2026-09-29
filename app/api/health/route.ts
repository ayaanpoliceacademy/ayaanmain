import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public health check — reports env presence (booleans only, NO secrets),
// DB URL *shape* (host/port/encoding flags, NO userinfo), and DB
// reachability with Prisma error code. Safe to expose.
function urlShape(raw: string | undefined) {
  if (!raw) return { present: false };
  const v = raw.trim().replace(/^["']|["']$/g, "");
  const qi = v.indexOf("?");
  const head = qi >= 0 ? v.slice(0, qi) : v;
  const tail = qi >= 0 ? v.slice(qi + 1) : "";
  const m = head.match(/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/([^@/]*@)?([^/:?#]+)(:(\d+))?(\/.*)?$/);
  const auth = (m && m[1] ? m[1].slice(0, -1) : "");
  let authHasRawAt = false;
  try {
    const pass = auth.includes(":") ? auth.slice(auth.indexOf(":") + 1) : auth;
    authHasRawAt = pass.includes("@") || /%(?![0-9A-Fa-f]{2})/.test(pass);
  } catch { authHasRawAt = true; }
  return {
    present: true,
    quoted: v !== raw.trim(),
    host: (m && m[3]) || null,
    port: (m && m[5]) || null,
    pooler: !!((m && m[3] && m[3].includes("pooler")) || tail.includes("pgbouncer=true")),
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
  let db: { reachable: boolean; code?: string | null; hint?: string } = { reachable: false };
  try {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$queryRaw`SELECT 1`;
    db = { reachable: true };
  } catch (e: any) {
    const code = e?.code || null;
    const hints: Record<string, string> = {
      P1000: "auth failed — wrong DB password (check %40 encoding of @)",
      P1001: "can't reach DB host — use Supabase pooler :6543 URI, not direct :5432",
      P1017: "connection closed — pooler recommended for serverless",
    };
    db = { reachable: false, code, hint: (code && hints[code]) || "check DATABASE_URL value + redeploy" };
  }
  const ok = env.databaseUrl && env.supabaseUrl && env.anonKey && env.serviceKey && db.reachable;
  return NextResponse.json({ ok, env, shape, db }, { status: ok ? 200 : 500 });
}
