import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { audit } from "@/lib/identifiers";
import { scopeFromAuth, resolveBranchFilter, canActOn, forbidBranch } from "@/lib/branch-scope";
import { sendEmail, tplComplaintReply } from "@/lib/email";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status") || "all";
  const category = searchParams.get("category") || "all";
  const q = (searchParams.get("q") || "").toLowerCase();

  const scope = scopeFromAuth(auth);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });

  const where: any = {};
  if (status && status !== "all") where.status = status;
  if (category && category !== "all") where.category = category;
  // Campus admins only see complaints from their campuses
  if (scope.branches !== null) where.branch = { in: scope.branches };
  else if (requested.branch) where.branch = requested.branch;

  const list = await prisma.complaint.findMany({ where, orderBy: { createdAt: "desc" }, take: 500 });

  const filtered = q
    ? list.filter((c) => `${c.studentName} ${c.email} ${c.phone || ""} ${c.subject} ${c.message} ${c.studentCode || ""} ${c.adminReply || ""}`.toLowerCase().includes(q))
    : list;

  return NextResponse.json(
    {
      rows: filtered,
      counts: {
        open: list.filter((c) => c.status === "open").length,
        in_progress: list.filter((c) => c.status === "in_progress").length,
        resolved: list.filter((c) => c.status === "resolved").length,
        total: list.length,
      },
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const actor = String(auth.session.username || auth.session.userId || "admin");
  const body = await req.json().catch(() => ({}));
  const { id, status, reply, priority } = body;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const item = await prisma.complaint.findUnique({ where: { id: String(id) } });
  if (!item) return NextResponse.json({ error: "Complaint not found" }, { status: 404 });
  if (!canActOn(scopeFromAuth(auth), item.branch)) return forbidBranch(item.branch);

  const data: any = {};
  if (priority !== undefined && ["low", "normal", "high"].includes(String(priority))) data.priority = String(priority);
  if (status !== undefined) {
    const s = String(status);
    if (!["open", "in_progress", "resolved"].includes(s)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    data.status = s;
    data.resolvedAt = s === "resolved" ? new Date() : null;
  }
  const replyText = reply !== undefined ? String(reply || "").trim().slice(0, 4000) : null;
  if (replyText) {
    data.adminReply = replyText;
    data.repliedBy = actor;
    data.repliedAt = new Date();
    if (!status) data.status = "in_progress";
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });

  const updated = await prisma.complaint.update({ where: { id: String(id) }, data });
  await audit("complaint", updated.id, actor, replyText ? "complaint_replied" : "complaint_updated", replyText ? replyText.slice(0, 200) : `status:${updated.status}`);

  // Email the student when a reply is sent
  if (replyText) {
    try {
      const tpl = tplComplaintReply({ subject: updated.subject, reply: replyText, studentName: updated.studentName });
      await sendEmail({ to: updated.email, subject: tpl.subject, html: tpl.html }).catch(() => {});
    } catch {}
  }

  return NextResponse.json({ ok: true, complaint: updated });
}
