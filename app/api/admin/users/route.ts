import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { isEmail, sanitizeText } from "@/lib/validators";
import { audit } from "@/lib/identifiers";

const ALLOWED_ROLES = ["super_admin", "finance", "admissions"];
const ALL_TABS = ["dashboard", "store", "orders", "alumni", "leads", "payments", "students", "finance", "dues", "expenses", "admissions", "rag", "batches", "masters", "banner", "fees", "admins"];

function sanitizePermissions(perms: any): string[] {
  if (!Array.isArray(perms)) return [];
  const out: string[] = [];
  for (const p of perms) {
    const v = String(p || "").trim();
    if (v && ALL_TABS.includes(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

// Campuses must exist in the Branch master — prevents typos that would silently
// scope an admin to a campus that does not exist (and hide all their data).
async function sanitizeBranches(input: any): Promise<string[]> {
  if (!Array.isArray(input)) return [];
  const wanted: string[] = [];
  for (const b of input) {
    const v = String(b || "").trim();
    if (v && !wanted.some((w) => w.toLowerCase() === v.toLowerCase())) wanted.push(v);
  }
  if (wanted.length === 0) return [];
  const all = await prisma.branch.findMany({ select: { name: true } });
  const byKey = new Map(all.map((b) => [b.name.trim().toLowerCase(), b.name]));
  const out: string[] = [];
  const unknown: string[] = [];
  for (const w of wanted) {
    const match = byKey.get(w.toLowerCase());
    if (match) { if (!out.includes(match)) out.push(match); }
    else unknown.push(w);
  }
  if (unknown.length > 0) {
    const err: any = new Error(`Unknown campus: ${unknown.join(", ")}`);
    (err as any).status = 400;
    throw err;
  }
  return out;
}

// GET /api/admin/users — list all admins (super_admin only)
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const admins = await prisma.admin.findMany({
    orderBy: { createdAt: "desc" },
    select: { id: true, username: true, email: true, role: true, name: true, mustChangePassword: true, permissions: true, branchIds: true, isActive: true, createdAt: true, updatedAt: true },
  });
  return NextResponse.json(admins, { headers: { "Cache-Control": "no-store" } });
}

// POST /api/admin/users — create admin with email, password, force change
export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const role = String(body.role || "").trim();
  const permissions = sanitizePermissions(body.permissions);
  let branchIds: string[] = [];
  try {
    branchIds = await sanitizeBranches(body.branchIds);
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
  let username = String(body.username || "").trim();

  if (!email || !email.includes("@")) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (!password || password.length < 8) return NextResponse.json({ error: "Password required (min 8 chars)" }, { status: 400 });
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  if (!ALLOWED_ROLES.includes(role)) return NextResponse.json({ error: `Role must be one of: ${ALLOWED_ROLES.join(", ")}` }, { status: 400 });
  // super_admin is always global — storing campuses on them would be misleading
  if (role === "super_admin") branchIds = [];

  // Derive username from email if not provided
  if (!username) username = email.split("@")[0].replace(/[^a-z0-9._-]/gi, "_").toLowerCase();
  // Ensure username unique — suffix if needed
  let baseUsername = username;
  let suffix = 0;
  while (await prisma.admin.findUnique({ where: { username } })) {
    suffix += 1;
    username = `${baseUsername}${suffix}`;
  }
  // Check email unique
  const existingEmail = await prisma.admin.findUnique({ where: { email } });
  if (existingEmail) return NextResponse.json({ error: "Email already exists as admin" }, { status: 400 });

  // Create Supabase auth user
  const { data: sbUser, error: sbError } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name, role },
  });
  if (sbError || !sbUser?.user) {
    // If Supabase says user already exists, try to link existing Supabase user
    const msg = sbError?.message || "Failed to create auth user";
    // Check if Supabase user exists by listing? Try to find via getUserByEmail not available, so try to just return error with hint
    if (msg.toLowerCase().includes("already")) {
      return NextResponse.json({ error: `Auth user already exists in Supabase: ${msg}. Delete it from Supabase Dashboard → Authentication or use different email.` }, { status: 400 });
    }
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  try {
    const admin = await prisma.admin.create({
      data: {
        username,
        email,
        supabaseId: sbUser.user.id,
        role,
        name,
        mustChangePassword: true,
        permissions,
        branchIds,
        isActive: body.isActive === false ? false : true,
      },
    });
    await audit("admin", admin.id, auth.session.username || auth.session.userId, "create", `${email} role:${role} campuses:${branchIds.join("|") || "ALL"}`);
    return NextResponse.json({ ok: true, admin: { id: admin.id, username: admin.username, email: admin.email, role: admin.role, name: admin.name, permissions: admin.permissions, branchIds: admin.branchIds, isActive: admin.isActive, mustChangePassword: admin.mustChangePassword } });
  } catch (e: any) {
    // Rollback Supabase user if Prisma fails
    try { await supabaseAdmin.auth.admin.deleteUser(sbUser.user.id); } catch {}
    if (e?.code === "P2002") return NextResponse.json({ error: "Username or email already exists" }, { status: 400 });
    return NextResponse.json({ error: e.message || "Failed to create admin" }, { status: 500 });
  }
}

// PUT /api/admin/users — update admin (role, permissions, isActive, name)
export async function PUT(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const body = await req.json().catch(() => ({}));
  const id = String(body.id || "").trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await prisma.admin.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  // Prevent deactivating / demoting self?
  const currentAdminId = (auth.session as any).admin?.id || (auth.session as any).userId;
  // Allow but warn if self-deactivate
  const data: any = {};
  if (body.name !== undefined) {
    const n = String(body.name || "").trim();
    if (!n) return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
    data.name = n;
  }
  if (body.role !== undefined) {
    const r = String(body.role || "").trim();
    if (!ALLOWED_ROLES.includes(r)) return NextResponse.json({ error: `Role must be one of: ${ALLOWED_ROLES.join(", ")}` }, { status: 400 });
    data.role = r;
    // Update Supabase user metadata role as well (optional)
    if (existing.supabaseId) {
      try { await supabaseAdmin.auth.admin.updateUserById(existing.supabaseId, { user_metadata: { role: r } } as any); } catch {}
    }
  }
  if (body.permissions !== undefined) {
    data.permissions = sanitizePermissions(body.permissions);
  }
  if (body.branchIds !== undefined) {
    try {
      const next = await sanitizeBranches(body.branchIds);
      // A super_admin is always global — storing campuses on them would be misleading
      data.branchIds = (body.role ?? existing.role) === "super_admin" ? [] : next;
    } catch (e: any) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
  }
  if (body.isActive !== undefined) {
    data.isActive = !!body.isActive;
    // If deactivating, delete sessions
    if (!data.isActive) {
      await prisma.session.deleteMany({ where: { userId: id } });
      // Also try username based sessions
      await prisma.session.deleteMany({ where: { username: existing.username } });
    }
  }
  if (body.email !== undefined && String(body.email).trim().toLowerCase() !== existing.email) {
    return NextResponse.json({ error: "Email cannot be changed — create new admin instead" }, { status: 400 });
  }
  // Support mustChangePassword reset
  if (body.mustChangePassword !== undefined) data.mustChangePassword = !!body.mustChangePassword;

  const updated = await prisma.admin.update({ where: { id }, data });
  await audit("admin", id, auth.session.username || auth.session.userId, "update", `${JSON.stringify(Object.keys(data))} campuses:${(updated.branchIds || []).join("|") || "ALL"}`);
  return NextResponse.json({ ok: true, admin: { id: updated.id, username: updated.username, email: updated.email, role: updated.role, name: updated.name, permissions: updated.permissions, branchIds: updated.branchIds, isActive: updated.isActive, mustChangePassword: updated.mustChangePassword } });
}

// DELETE /api/admin/users?id=xxx
export async function DELETE(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id") || "";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await prisma.admin.findUnique({ where: { id } });
  if (!existing) return NextResponse.json({ error: "Admin not found" }, { status: 404 });
  const currentAdminId = (auth.session as any).admin?.id || (auth.session as any).userId;
  if (existing.id === currentAdminId) return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
  // Prevent deleting last super_admin
  if (existing.role === "super_admin") {
    const superCount = await prisma.admin.count({ where: { role: "super_admin", isActive: true } });
    if (superCount <= 1) return NextResponse.json({ error: "Cannot delete the last active super_admin" }, { status: 400 });
  }
  // Delete Supabase user if exists
  if (existing.supabaseId) {
    try { await supabaseAdmin.auth.admin.deleteUser(existing.supabaseId); } catch {}
  }
  await prisma.session.deleteMany({ where: { OR: [{ userId: id }, { username: existing.username }] } });
  await prisma.admin.delete({ where: { id } });
  await audit("admin", id, auth.session.username || auth.session.userId, "delete", existing.email);
  return NextResponse.json({ ok: true });
}
