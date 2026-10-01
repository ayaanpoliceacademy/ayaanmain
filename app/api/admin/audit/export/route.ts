import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { scopeFromAuth, resolveBranchFilter } from "@/lib/branch-scope";
import { pruneAuditLogs } from "@/lib/identifiers";

const EXPORT_CAP = 20000;

function csvCell(v: any): string {
  const s = String(v ?? "");
  // Guard against CSV/formula injection in exported files
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

// GET /api/admin/audit/export — CSV of the activity log, same filters as the UI.
export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;

  pruneAuditLogs().catch(() => {});

  const { searchParams } = new URL(req.url);
  const entity = searchParams.get("entity") || "";
  const action = searchParams.get("action") || "";
  const actorType = searchParams.get("actorType") || "";
  const from = searchParams.get("from") || "";
  const to = searchParams.get("to") || "";
  const q = (searchParams.get("q") || "").toLowerCase();

  const where: any = {};
  if (entity && entity !== "all") where.entity = entity;
  if (action && action !== "all") where.action = action;
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = new Date(`${from}T00:00:00`);
    if (to) where.createdAt.lte = new Date(`${to}T23:59:59`);
  }

  const scope = scopeFromAuth(auth);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });

  const logs = await prisma.auditLog.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: EXPORT_CAP,
    select: { createdAt: true, actor: true, action: true, entity: true, entityId: true, note: true },
  });

  const actorKeys = Array.from(new Set(logs.map((l) => String(l.actor || "").trim().toLowerCase()).filter(Boolean)));
  const [admins, users] = actorKeys.length > 0
    ? await Promise.all([
        prisma.admin.findMany({ where: { OR: [{ email: { in: actorKeys } }, { username: { in: actorKeys } }, { id: { in: actorKeys } }] }, select: { id: true, name: true, email: true, username: true, role: true } }),
        prisma.user.findMany({ where: { OR: [{ email: { in: actorKeys } }, { phone: { in: actorKeys } }, { id: { in: actorKeys } }] }, select: { id: true, name: true, email: true, studentId: true, branch: true } }),
      ])
    : [[], []];
  const adminBy = new Map<string, any>();
  for (const a of admins) for (const k of [a.id, a.email?.toLowerCase(), a.username?.toLowerCase()]) if (k) adminBy.set(String(k), a);
  const userBy = new Map<string, any>();
  for (const u of users) for (const k of [u.id, u.email?.toLowerCase()]) if (k) userBy.set(String(k), u);

  let rows = logs.map((l) => {
    const key = String(l.actor || "").trim().toLowerCase();
    const admin = adminBy.get(key);
    const user = userBy.get(key);
    return {
      createdAt: l.createdAt,
      actorName: admin?.name || user?.name || String(l.actor || "").split("@")[0] || "Unknown",
      actorType: admin ? "admin" : user ? "student" : "system",
      actorRole: admin ? admin.role : user ? "student" : "system",
      actorEmail: admin?.email || user?.email || "",
      studentCode: user?.studentId || "",
      campus: user?.branch || "",
      action: l.action,
      entity: l.entity,
      entityId: l.entityId,
      note: l.note || "",
    };
  });

  if (scope.branches !== null) {
    const allowed = scope.branches.map((b) => b.toLowerCase());
    rows = rows.filter((r) => {
      if (r.actorType === "admin") return true;
      const b = String(r.campus || "").toLowerCase();
      return b === "" || allowed.includes(b);
    });
  }
  if (actorType && actorType !== "all") rows = rows.filter((r) => r.actorType === actorType);
  if (q) rows = rows.filter((r) => `${r.actorName} ${r.actorEmail} ${r.action} ${r.entity} ${r.entityId} ${r.note}`.toLowerCase().includes(q));

  const header = ["Timestamp (IST)", "User", "Actor Type", "Role", "Email", "Student ID", "Campus", "Action", "Area", "Record ID", "Details"];
  const lines = [header.map(csvCell).join(",")];
  for (const r of rows) {
    const ist = new Date(new Date(r.createdAt).getTime() + 5.5 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
    lines.push([
      ist, r.actorName, r.actorType, r.actorRole, r.actorEmail, r.studentCode, r.campus,
      r.action, r.entity, r.entityId, r.note,
    ].map(csvCell).join(","));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(`\uFEFF${lines.join("\r\n")}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="ayaan-activity-log-${stamp}.csv"`,
      "Cache-Control": "no-store",
      "X-Export-Rows": String(rows.length),
      "X-Export-Truncated": logs.length >= EXPORT_CAP ? "1" : "0",
    },
  });
}