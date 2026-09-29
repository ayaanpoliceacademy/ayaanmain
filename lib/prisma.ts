import { PrismaClient } from "@prisma/client";

// Normalize common DATABASE_URL paste mistakes (documented, warns in logs):
// - surrounding quotes, leading/trailing whitespace
// - duplicate ? in query string (?a=1?b=2 → ?a=1&b=2)
// - raw special chars in password (Sunanm@4354 → Sunanm%404354).
// Accepts both raw and already-encoded passwords (decode→encode is stable).
function normalizeDatabaseUrl(raw: string | undefined): string | undefined {
  if (!raw) return raw;
  let url = raw.trim();
  // Strip KEY= prefix if the whole `DATABASE_URL=...` line was pasted as the value
  const keyPrefix = url.match(/^(DATABASE_URL|DIRECT_URL|POSTGRES_URL|POSTGRES_PRISMA_URL)\s*=\s*/i);
  if (keyPrefix) {
    console.warn("[prisma] DATABASE_URL included the KEY= prefix — stripped. Paste only the URL value in the env dashboard.");
    url = url.slice(keyPrefix[0].length).trim();
  }
  if ((url.startsWith('"') && url.endsWith('"')) || (url.startsWith("'") && url.endsWith("'"))) {
    console.warn("[prisma] DATABASE_URL had surrounding quotes — stripped. Remove them in the env dashboard.");
    url = url.slice(1, -1).trim();
  }
  // Connection strings never contain whitespace — a pasted line-break/space breaks parsing
  if (/\s/.test(url)) {
    console.warn("[prisma] DATABASE_URL contained whitespace/newlines — removed. Check the pasted value.");
    url = url.replace(/\s+/g, "");
  }
  const qi = url.indexOf("?");
  if (qi >= 0) {
    const tail = url.slice(qi + 1).replace(/\?/g, "&");
    if (tail !== url.slice(qi + 1)) console.warn("[prisma] DATABASE_URL had duplicate ? — normalized to &.");
    url = url.slice(0, qi + 1) + tail;
  }
  const m = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)(.*)$/);
  if (m) {
    const [, scheme, rest] = m;
    const at = rest.lastIndexOf("@");
    const slash = rest.indexOf("/");
    if (at > 0 && (slash < 0 || at < slash)) {
      const userinfo = rest.slice(0, at);
      const after = rest.slice(at);
      const colon = userinfo.indexOf(":");
      if (colon >= 0) {
        const user = userinfo.slice(0, colon);
        const pass = userinfo.slice(colon + 1);
        let encoded: string;
        try {
          encoded = encodeURIComponent(decodeURIComponent(pass));
        } catch {
          encoded = encodeURIComponent(pass);
        }
        if (encoded !== pass) console.warn("[prisma] DATABASE_URL password was not URL-encoded — auto-encoded. Please store it encoded (%40 for @).");
        url = `${scheme}${user}:${encoded}${after}`;
      }
    }
  }
  return url;
}

const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
// NOTE: validation throws only at runtime, never during `next build`
// (NEXT_PHASE=phase-production-build). Build only imports modules to collect
// page data — failing there turns a fixable env mistake into a failed deploy.
const isBuildPhase = process.env.NEXT_PHASE === "phase-production-build";
if (!databaseUrl) {
  if (!isBuildPhase) {
    throw new Error("Missing DATABASE_URL — set it in Vercel Project → Settings → Environment Variables, then Redeploy.");
  }
} else if (/[<>]/.test(databaseUrl)) {
  if (!isBuildPhase) {
    throw new Error("DATABASE_URL contains a <placeholder> (e.g. <region>) — replace it with the real value from Supabase Dashboard → Settings → Database → Transaction pooler (e.g. ap-southeast-1), then Redeploy.");
  }
}
if (databaseUrl && databaseUrl !== process.env.DATABASE_URL) process.env.DATABASE_URL = databaseUrl;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

export const prisma =
  globalForPrisma.prisma ||
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["query", "error", "warn"] : ["error"],
  });

// Reuse the client across serverless invocations in ALL envs.
// Without this, Vercel production opens a new DB pool per invocation
// and Supabase direct connections exhaust → 500s under any traffic.
globalForPrisma.prisma = prisma;