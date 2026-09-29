import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

// Public health check — reports env presence (booleans only, NO secrets)
// and DB reachability with Prisma error code. Safe to expose.
export async function GET() {
  const env = {
    databaseUrl: !!process.env.DATABASE_URL,
    supabaseUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
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
  return NextResponse.json({ ok, env, db }, { status: ok ? 200 : 500 });
}
