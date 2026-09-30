import { NextRequest, NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const expenses = await prisma.expense.findMany({ orderBy: { createdAt: "desc" }, take: 2000 });
  return NextResponse.json(expenses, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { id, title, expense, category, amount, paidBy, paymentMethod, expenseDate, dueDate, status, vendor, notes, action } = body;

  // Handle approval actions (super_admin only) — before validation since action-only payload has no title/amount
  if (action && id) {
    if (auth.session.role !== "super_admin") return NextResponse.json({ error: "Only super_admin can approve" }, { status: 403 });
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (action === "approve") {
      const updated = await prisma.expense.update({ where: { id }, data: { status: "approved", approvedBy: auth.session.username } });
      return NextResponse.json(updated);
    }
    if (action === "reject") {
      const updated = await prisma.expense.update({ where: { id }, data: { status: "rejected", approvedBy: auth.session.username } });
      return NextResponse.json(updated);
    }
    if (action === "markPaid") {
      const updated = await prisma.expense.update({ where: { id }, data: { status: "paid", approvedBy: auth.session.username } });
      return NextResponse.json(updated);
    }
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  const expenseTitle = String(expense || title || "").trim();
  if (!expenseTitle || amount === undefined) return NextResponse.json({ error: "expense and amount required" }, { status: 400 });

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
  };

  if (id) {
    const existing = await prisma.expense.findUnique({ where: { id } });
    if (existing) {
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
  return NextResponse.json(item);
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  await prisma.expense.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
