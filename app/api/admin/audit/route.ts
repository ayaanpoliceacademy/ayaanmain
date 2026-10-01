import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { scopeFromAuth, resolveBranchFilter } from "@/lib/branch-scope";

// Global activity log for super_admin / finance.
//
// AuditLog.actor is a username-or-email string, so every row is resolved against
// Admin and User to show the real display name and whether the actor was an admin,
// a student, or an anonymous/system actor.
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;

  const { searchParams } = new URL(req.url);
  const entity = searchParams.get("entity") || "";
  const entityId = searchParams.get("entityId") || "";
  const action = searchParams.get("action") || "";
  const actorFilter = searchParams.get("actor") || "";
  const actorType = searchParams.get("actorType") || ""; // admin | student | system
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10) || 1);
  const size = Math.min(200, Math.max(10, parseInt(searchParams.get("size") || "50", 10) || 50));
  const q = (searchParams.get("q") || "").toLowerCase();

  const where: any = {};
  if (entity && entity !== "all") where.entity = entity;
  if (entityId) where.entityId = entityId;
  if (action && action !== "all") where.action = action;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59`);
  }
  // Campus scope: a campus admin only sees activity on their campuses' records
  const scope = scopeFromAuth(auth);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });

  // NOTE: AuditLog has no branch column, so campus scoping, actor-type and text
  // search must all be applied in memory. We therefore filter a bounded window and
  // count AFTER filtering — otherwise `total` reports the pre-filter global count
  // (leaking other campuses' volume) and paging skips the wrong rows entirely.
  const SCAN_CAP = 5000;
  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: SCAN_CAP,
    select: { id: true, createdAt: true, actor: true, action: true, entity: true, entityId: true, note: true },
  });
  const truncated = logs.length >= SCAN_CAP;

  // ---- Resolve actor identity (admin first, then student) ----
  const actorKeys = Array.from(new Set(logs.map((l) => String(l.actor || "").trim().toLowerCase()).filter(Boolean)));
  const [admins, users] = actorKeys.length > 0
    ? await Promise.all([
        prisma.admin.findMany({ where: { OR: [{ email: { in: actorKeys } }, { username: { in: actorKeys } }, { id: { in: actorKeys } }] }, select: { id: true, name: true, email: true, username: true, role: true } }),
        prisma.user.findMany({ where: { OR: [{ email: { in: actorKeys } }, { phone: { in: actorKeys } }, { id: { in: actorKeys } }] }, select: { id: true, name: true, email: true, phone: true, studentId: true, branch: true } }),
      ])
    : [[], []];
  const adminBy = new Map<string, any>();
  for (const a of admins) {
    for (const k of [a.id, a.email?.toLowerCase(), a.username?.toLowerCase()]) if (k) adminBy.set(String(k), a);
  }
  const userBy = new Map<string, any>();
  for (const u of users) {
    for (const k of [u.id, u.email?.toLowerCase(), u.phone]) if (k) userBy.set(String(k), u);
  }

  // Campus admins: keep only rows belonging to their campuses (best-effort via student/admission)
  let rows = logs.map((l) => {
    const key = String(l.actor || "").trim().toLowerCase();
    const admin = adminBy.get(key) || null;
    const user = userBy.get(key) || null;
    let actorName = admin?.name || user?.name || null;
    let actorRole = admin ? admin.role : user ? "student" : "system";
    if (!actorName) actorName = String(l.actor || "").split("@")[0] || "Unknown";
    return {
      id: l.id,
      createdAt: l.createdAt,
      actor: l.actor,
      actorName,
      actorRole,
      actorType: admin ? "admin" : user ? "student" : "system",
      actorEmail: admin?.email || user?.email || null,
      actorCode: user?.studentId || null,
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      note: l.note,
    };
  });

  if (scope.branches !== null) {
    const allowed = scope.branches.map((b) => b.toLowerCase());
    rows = rows.filter((r) => {
      if (r.actorType === "admin") return true; // admins always see the trail
      const b = String(userBy.get(String(r.actor || "").toLowerCase())?.branch || "").toLowerCase();
      // Blank campus = unassigned/central — shown to every campus admin, like the other tabs
      return b === "" || allowed.includes(b);
    });
  }

  if (actorType && actorType !== "all") rows = rows.filter((r) => r.actorType === actorType);
  if (actorFilter) {
    const af = actorFilter.toLowerCase();
    rows = rows.filter((r) => `${r.actorName} ${r.actor} ${r.actorEmail || ""}`.toLowerCase().includes(af));
  }
  if (q) {
    rows = rows.filter((r) => `${r.actorName} ${r.actor} ${r.action} ${r.entity} ${r.entityId} ${r.note || ""}`.toLowerCase().includes(q));
  }

  // Count AFTER every filter so the header, paging and rows always agree
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const paged = rows.slice((page - 1) * size, page * size);

  // Distinct values for the filter dropdowns
  const [entities, actions] = await Promise.all([
    prisma.auditLog.groupBy({ by: ["entity"], _count: { _all: true }, orderBy: { entity: "asc" } }),
    prisma.auditLog.groupBy({ by: ["action"], _count: { _all: true }, orderBy: { action: "asc" } }),
  ]);

  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const since24h = startOfToday - 24 * 60 * 60 * 1000;

  return NextResponse.json(
    {
      rows: paged,
      total,
      page,
      size,
      pages,
      truncated,
      entities: entities.map((e) => ({ value: e.entity, count: e._count._all })),
      actions: actions.map((a) => ({ value: a.action, count: a._count._all })),
      summary: {
        today: rows.filter((r) => new Date(r.createdAt).getTime() >= startOfToday).length,
        last24h: rows.filter((r) => new Date(r.createdAt).getTime() >= since24h).length,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
