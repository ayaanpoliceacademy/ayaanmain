import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { scopeFromAuth, resolveBranchFilter, canActOn, forbidBranch, allowedBranches } from "@/lib/branch-scope";
import { audit } from "@/lib/identifiers";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const scope = scopeFromAuth(auth);
  const { searchParams } = new URL(req.url);
  const requested = resolveBranchFilter(scope, searchParams.get("branch"));
  if (requested.error) return NextResponse.json({ error: requested.error }, { status: 403 });
  const where: any = {};
  if (scope.branches !== null) where.branch = { in: scope.branches };
  else if (requested.branch) where.branch = requested.branch;
  const expenses = await prisma.expense.findMany({ where, orderBy: { createdAt: "desc" }, take: 2000 });
  return NextResponse.json(expenses, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { id, title, expense, category, amount, paidBy, paymentMethod, expenseDate, dueDate, status, vendor, notes, action, branch } = body;
  const scope = scopeFromAuth(auth);
  const actor = String(auth.session.username || auth.session.userId || "admin");

  // Handle approval actions (super_admin only) — before validation since action-only payload has no title/amount
  if (action && id) {
    if (auth.session.role !== "super_admin") return NextResponse.json({ error: "Only super_admin can approve" }, { status: 403 });
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!canActOn(scope, existing.branch)) return forbidBranch(existing.branch);
    const nextStatus = action === "approve" ? "approved" : action === "reject" ? "rejected" : action === "markPaid" ? "paid" : null;
    if (nextStatus) {
      const updated = await prisma.expense.update({ where: { id }, data: { status: nextStatus, approvedBy: auth.session.username } });
      await audit("expense", id, actor, `expense_${nextStatus}`, `${existing.title} - ?${Number(existing.amount || 0).toLocaleString("en-IN")} [${existing.branch || "unassigned"}]`);
      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const expenseTitle = String(expense || title || "").trim();
  if (!expenseTitle || amount === undefined) return NextResponse.json({ error: "expense and amount required" }, { status: 400 });

  // Campus: a campus admin can only file against their own campuses
  const requestedBranch = resolveBranchFilter(scope, branch);
  if (requestedBranch.error) return NextResponse.json({ error: requestedBranch.error }, { status: 403 });
  const targetBranch = requestedBranch.branch ?? (scope.branches && scope.branches.length === 1 ? scope.branches[0] : "");
  if (!canActOn(scope, targetBranch)) return forbidBranch(targetBranch);

  // Determine status: client cannot force approved — only super_admin may set approved
  const isSuper = auth.session.role === "super_admin";
  const finalStatus = isSuper ? (status ? String(status) : "approved") : "pending";

  const amt = Number(amount);
  if (!Number.isFinite(amt) || amt <= 0 || amt > 1e8) return NextResponse.json({ error: "amount must be positive (1 - 100000000)" }, { status: 400 });
  const data: any = {
    title: expenseTitle,
    category: String(category || "General"),
    amount: Math.round(amt),
    paidBy: paidBy ? String(paidBy).trim() : null,
    paymentMethod: ["cash", "UPI", "upi", "bank"].includes(String(paymentMethod || "").toLowerCase()) ? String(paymentMethod).toLowerCase() : "cash",
    expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
    dueDate: dueDate ? new Date(dueDate) : new Date(),
    status: finalStatus,
    vendor: String(vendor || paidBy || "").trim(),
    notes: String(notes || "").trim(),
    branch: targetBranch,
  };

  if (id) {
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (existing) {
      if (!canActOn(scope, existing.branch)) return forbidBranch(existing.branch);
      // Enforce ownership for non-super: can only edit own pending
      if (!isSuper) {
        if (existing.status !== "pending" || existing.requestedBy !== auth.session.username) {
          return NextResponse.json({ error: "Can only edit own pending expenses" }, { status: 403 });
        }
      }
      const updated = await prisma.expense.update({
        where: { id },
        data: { ...data, approvedBy: isSuper && finalStatus === "approved" ? auth.session.username : existing.approvedBy },
      });
      await audit("expense", id, actor, "expense_updated", `${updated.title} - ?${Number(updated.amount || 0).toLocaleString("en-IN")} [${updated.branch || "unassigned"}]`);
      return NextResponse.json(updated);
    }
  }

  const item = await prisma.expense.create({
    data: {
      id: id || `EXP-${Date.now()}`,
      ...data,
      requestedBy: auth.session.username,
      approvedBy: isSuper ? auth.session.username : null,
    },
  });
  await audit("expense", item.id, actor, isSuper ? "expense_approved" : "expense_submitted", `${item.title} - ?${Number(item.amount || 0).toLocaleString("en-IN")} [${item.branch || "unassigned"}]`);
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const existing = await prisma.expense.findUnique({ where: { id } });
  if (existing && !canActOn(scopeFromAuth(auth), existing.branch)) return forbidBranch(existing.branch);
  await prisma.expense.delete({ where: { id } });
  await audit("expense", id, String(auth.session.username || auth.session.userId || "admin"), "expense_deleted", existing ? `${existing.title} - ?${Number(existing.amount || 0).toLocaleString("en-IN")}` : "");
  return NextResponse.json({ ok: true });
}
