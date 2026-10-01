import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { scopeFromAuth, resolveBranchFilter, canActOn, forbidBranch } from "@/lib/branch-scope";
import { supabaseAdmin } from "@/lib/supabase";

function stripSensitive(user: any) {
  const { passwordHash, supabaseId, ...safe } = user;
  return safe;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions", "finance"]);
  if (auth.error) return auth.error;
  const scope = scopeFromAuth(auth);
  const { searchParams } = new URL(req.url);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });
  const where: any = {};
  if (scope.branches !== null) where.branch = { in: scope.branches };
  else if (requested.branch) where.branch = requested.branch;
  const users = await prisma.user.findMany({ where, orderBy: { createdAt: "desc" }, take: 2000 });
  return NextResponse.json(users.map(stripSensitive), { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { id, action, password, name, fatherName, email, phone, address, reference, branch, course, courseType, medium, mode, active } = body;

  if (action === "create") {
    if (!name || !email || !phone || !password) return NextResponse.json({ error: "name, email, phone, password required" }, { status: 400 });
    if (!/^[0-9]{10}$/.test(String(phone))) return NextResponse.json({ error: "phone must be 10 digits" }, { status: 400 });
    if (password.length < 8) return NextResponse.json({ error: "password min 6 chars" }, { status: 400 });
    const exists = await prisma.user.findUnique({ where: { email: String(email).toLowerCase() } });
    if (exists) return NextResponse.json({ error: "Email already exists" }, { status: 400 });

    // Create Supabase Auth user first
    const { data: supaData, error: supaError } = await supabaseAdmin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: String(password),
      email_confirm: true,
      user_metadata: { name: String(name).trim(), phone: String(phone).trim(), course: String(course || "SI") },
    });
    if (supaError) return NextResponse.json({ error: `Supabase error: ${supaError.message}` }, { status: 400 });

    const user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        fatherName: String(fatherName || "").trim(),
        email: String(email).trim().toLowerCase(),
        phone: String(phone).trim(),
        address: String(address || "").trim(),
        reference: String(reference || "").trim(),
        branch: String(branch || ""),
        course: String(course || "SI"),
        courseType: String(courseType || "Regular"),
        medium: String(medium || "Telugu"),
        mode: String(mode || "Residential"),
        supabaseId: supaData.user.id,
        isActive: true,
      },
    });
    return NextResponse.json({ ok: true, user: stripSensitive(user) });
  }

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

  let updated: any;
  if (action === "toggleActive") {
    updated = await prisma.user.update({ where: { id }, data: { isActive: active !== undefined ? !!active : !user.isActive } });
    // Optionally also ban/unban in Supabase
    if (user.supabaseId) {
      await supabaseAdmin.auth.admin.updateUserById(user.supabaseId, { ban_duration: updated.isActive ? "none" : "876000h" } as any);
    }
  } else if (action === "resetPassword") {
    if (!password || password.length < 8) return NextResponse.json({ error: "Password min 6 chars" }, { status: 400 });
    if (user.supabaseId) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.supabaseId, { password: String(password) });
      if (error) return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 400 });
    } else {
      // Create Supabase user if not exists (migration case)
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email: user.email,
        password: String(password),
        email_confirm: true,
      });
      if (error) return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 400 });
      await prisma.user.update({ where: { id }, data: { supabaseId: data.user.id } });
    }
    updated = await prisma.user.findUnique({ where: { id } });
  } else if (action === "update") {
    const newEmail = email ? String(email).toLowerCase() : undefined;
    // If email changing, update Supabase as well
    if (newEmail && newEmail !== user.email && user.supabaseId) {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(user.supabaseId, { email: newEmail });
      if (error) return NextResponse.json({ error: `Supabase error: ${error.message}` }, { status: 400 });
    }
    updated = await prisma.user.update({
      where: { id },
      data: {
        name: name ? String(name) : undefined,
        fatherName: fatherName !== undefined ? String(fatherName) : undefined,
        email: newEmail,
        phone: phone ? String(phone) : undefined,
        address: address !== undefined ? String(address) : undefined,
        reference: reference !== undefined ? String(reference) : undefined,
        branch: branch !== undefined ? String(branch) : undefined,
        course: course ? String(course) : undefined,
        courseType: courseType !== undefined ? String(courseType) : undefined,
        medium: medium ? String(medium) : undefined,
        mode: mode ? String(mode) : undefined,
      },
    });
  } else if (action === "delete") {
    if (user.supabaseId) {
      await supabaseAdmin.auth.admin.deleteUser(user.supabaseId);
    }
    await prisma.user.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true, user: stripSensitive(updated) });
}
