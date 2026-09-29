import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { supabase } from "@/lib/supabase";
import crypto from "crypto";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { hashToken } from "@/lib/auth-helpers";

const SESSION_EXPIRY_DAYS = 7;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const rl = rateLimit(`auth_login:${ip}`, 5, 10 * 60 * 1000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many attempts — try again later" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } });
  const { email, phone, password } = await req.json();
  const identifier = (email || phone || "").toString().trim().toLowerCase();
  if (!identifier || !password) return NextResponse.json({ error: "email/phone and password required" }, { status: 400 });

  // Resolve email from identifier (email or phone)
  let emailToCheck = identifier;
  if (!identifier.includes("@")) {
    // phone provided, lookup email
    const byPhone = await prisma.user.findFirst({ where: { phone: identifier } });
    if (!byPhone) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    emailToCheck = byPhone.email.toLowerCase();
  }

  // Authenticate via Supabase Auth only
  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailToCheck,
    password: String(password),
  });

  if (error || !data.user) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }

  // Lookup prisma user by email or supabaseId
  let user = await prisma.user.findUnique({ where: { email: emailToCheck } });
  if (!user) {
    user = await prisma.user.findFirst({ where: { supabaseId: data.user.id } });
  }
  if (!user) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  if (!user.isActive) {
    await supabase.auth.signOut();
    return NextResponse.json({ error: "Account deactivated" }, { status: 403 });
  }

  // Link supabaseId if not already
  if (!user.supabaseId) {
    await prisma.user.update({ where: { id: user.id }, data: { supabaseId: data.user.id } });
  }

  // Create our session
  const token = crypto.randomBytes(32).toString("hex");
  const hashed = hashToken(token);
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_DAYS * 24 * 60 * 60 * 1000);
  try {
    const existing = await prisma.session.findMany({ where: { userId: user.id }, orderBy: { createdAt: "asc" } });
    if (existing.length >= 10) await prisma.session.deleteMany({ where: { id: { in: existing.slice(0, existing.length - 9).map((s) => s.id) } } });
  } catch {}
  await prisma.session.create({ data: { token: hashed, userId: user.id, role: "student", username: user.email, name: user.name, expiresAt } });

  await supabase.auth.signOut();

  const res = NextResponse.json({ ok: true, mustChangePassword: !!user.mustChangePassword, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, course: user.course } });
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
  if (!token) return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  const hashed = hashToken(token);
  let session: any = await prisma.session.findUnique({ where: { token: hashed } });
  if (!session) session = await prisma.session.findUnique({ where: { token } });
  if (!session || session.expiresAt < new Date()) {
    if (session) try { await prisma.session.delete({ where: { token: hashed } }); } catch { try { await prisma.session.delete({ where: { token } }); } catch {} }
    return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  }
  if (session.role !== "student") {
    return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  }
  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user) return NextResponse.json({ authenticated: false }, { headers: { "Cache-Control": "no-store" } });
  return NextResponse.json({ authenticated: true, user: { id: user.id, name: user.name, email: user.email, phone: user.phone, course: user.course } }, { headers: { "Cache-Control": "no-store" } });
}
