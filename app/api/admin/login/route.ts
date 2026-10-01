import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { supabase, supabaseAdmin, usernameToEmail } from "@/lib/supabase";
import crypto from "crypto";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { hashToken } from "@/lib/auth-helpers";
import { audit } from "@/lib/identifiers";

const SESSION_EXPIRY_DAYS = 7;

export async function POST(req: NextRequest) {
  // Rate limit: 5 login attempts per 10 min per IP
  const ip = getClientIp(req);
  const rl = rateLimit(`admin_login:${ip}`, 5, 10 * 60 * 1000);
  if (!rl.allowed) {
    console.log("[auth] login rate-limited POST /api/admin/login");
    return NextResponse.json({ ok: false, error: "Too many attempts — try again later" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } });
  }

  const { username, email, password } = await req.json();
  const raw = String(username || email || "").trim();
  if (!raw || !password) return NextResponse.json({ ok: false, error: "Email/username and password required" }, { status: 400 });

  const emailToCheck = usernameToEmail(raw);

  // Authenticate via Supabase Auth only - no hardcoded fallback
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailToCheck,
    password: String(password),
  });

  if (error || !data.user) {
    console.log(`[auth] login bad-credentials POST /api/admin/login err=${error?.message || "?"}`);
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  // Lookup admin role from Prisma via email or supabaseId
  let admin = await prisma.admin.findUnique({ where: { email: emailToCheck } });
  if (!admin) {
    // Try by supabaseId
    admin = await prisma.admin.findFirst({ where: { supabaseId: data.user.id } });
  }
  if (!admin && raw.includes("@")) {
    // Direct email lookup lowercased fallback
    admin = await prisma.admin.findUnique({ where: { email: raw.toLowerCase() } });
  }
  if (!admin) {
    // Uniform error to prevent enumeration
    await supabase.auth.signOut();
    console.log("[auth] login no-admin-record POST /api/admin/login");
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  if ((admin as any).isActive === false) {
    await supabase.auth.signOut();
    console.log("[auth] login inactive POST /api/admin/login");
    return NextResponse.json({ ok: false, error: "Account is deactivated — contact super admin" }, { status: 403 });
  }

  // Ensure supabaseId is linked
  if (!admin.supabaseId) {
    await prisma.admin.update({ where: { id: admin.id }, data: { supabaseId: data.user.id } });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const hashed = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  // Limit concurrent sessions: keep max 10 per admin, delete oldest
  try {
    const existing = await prisma.session.findMany({ where: { userId: admin.id }, orderBy: { createdAt: "asc" } });
    if (existing.length >= 10) {
      const toDelete = existing.slice(0, existing.length - 9);
      await prisma.session.deleteMany({ where: { id: { in: toDelete.map((s) => s.id) } } });
    }
  } catch {}
  await prisma.session.create({
    data: { token: hashed, userId: admin.id, role: admin.role, username: admin.username, name: admin.name, expiresAt },
  });
  console.log(`[auth] login ok POST /api/admin/login role=${admin.role}`);

  // Also sign out the temporary Supabase session (we use our own session cookie)
  await supabase.auth.signOut();

  const allowedTabs = (admin as any).permissions && (admin as any).permissions.length > 0 ? (admin as any).permissions : undefined;
  const res = NextResponse.json({
    ok: true,
    role: admin.role,
    name: admin.name,
    email: admin.email,
    mustChangePassword: (admin as any).mustChangePassword || false,
    permissions: allowedTabs || null,
    // Campus scope — empty array means this admin sees every campus
    campuses: Array.isArray((admin as any).branchIds) && admin.role !== "super_admin" ? (admin as any).branchIds : [],
    allCampuses: admin.role === "super_admin" || !(Array.isArray((admin as any).branchIds) && (admin as any).branchIds.length > 0),
  });
  await audit("admin", admin.id, admin.email, "admin_login", `${admin.name} (${admin.role}) from ${ip}`);
  res.cookies.set("ayaan_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_EXPIRY_DAYS,
  });
  return res;
}

export async function DELETE(req: NextRequest) {
  const token = req.cookies.get("ayaan_session")?.value;
  if (token) {
    const hashed = hashToken(token);
    try { await prisma.session.delete({ where: { token: hashed } }); } catch { try { await prisma.session.deleteMany({ where: { token } }); } catch {} }
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("ayaan_session", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get("ayaan_session")?.value;
  if (!token) return NextResponse.json({ authenticated: false });
  const hashed = hashToken(token);
  let session: any = await prisma.session.findUnique({ where: { token: hashed } });
  if (!session) session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    if (session) try { await prisma.session.delete({ where: { token: hashed } }); } catch { try { await prisma.session.delete({ where: { token } }); } catch {} }
    return NextResponse.json({ authenticated: false });
  }
  // Enrich with admin details if available
  let admin: any = null;
  try {
    admin = await prisma.admin.findFirst({
      where: { OR: [{ id: session.userId }, { username: session.username }, { email: session.username }] },
    });
    if (!admin && session.username && session.username.includes("@")) {
      admin = await prisma.admin.findUnique({ where: { email: session.username.toLowerCase() } });
    }
  } catch {}
  if (admin) {
    const allowedTabs = admin.permissions && admin.permissions.length > 0 ? admin.permissions : undefined;
    return NextResponse.json({
      authenticated: true,
      role: session.role,
      user: session.username,
      email: admin.email,
      name: admin.name,
      mustChangePassword: admin.mustChangePassword || false,
      permissions: allowedTabs || null,
      isActive: admin.isActive,
      campuses: Array.isArray(admin.branchIds) && admin.role !== "super_admin" ? admin.branchIds : [],
      allCampuses: admin.role === "super_admin" || !(Array.isArray(admin.branchIds) && admin.branchIds.length > 0),
    });
  }
  return NextResponse.json({ authenticated: true, role: session.role, user: session.username });
}
