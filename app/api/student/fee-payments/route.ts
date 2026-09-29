import { NextRequest, NextResponse } from "next/server";
import { requireStudentSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { uploadDataUrl } from "@/lib/storage";
import { audit } from "@/lib/identifiers";
import { sendEmail, tplPaymentAck } from "@/lib/email";

const METHODS = ["cash", "upi", "bank", "razorpay"];

// GET own fee payments with allocations + receipts
export async function GET(req: NextRequest) {
  const auth = await requireStudentSession(req);
  if (auth.error) return auth.error;
  const list = await prisma.feePayment.findMany({
    where: { studentId: auth.session.userId },
    include: { allocations: { include: { installment: true } }, receipt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(list, { headers: { "Cache-Control": "no-store" } });
}

// POST record a payment (submitted → admin acknowledges). Razorpay continues via razorpay-order.
export async function POST(req: NextRequest) {
  const auth = await requireStudentSession(req);
  if (auth.error) return auth.error;
  const user = await prisma.user.findUnique({ where: { id: auth.session.userId } });
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  const body = await req.json();
  const { admissionId, installmentId, amount, method, transactionId, screenshot, note } = body;
  if (!admissionId || !amount || !method) {
    return NextResponse.json({ error: "admissionId, amount, method required" }, { status: 400 });
  }
  const m = String(method).toLowerCase();
  if (!METHODS.includes(m)) return NextResponse.json({ error: "method must be cash|upi|bank|razorpay" }, { status: 400 });
  const amt = Math.round(Number(amount));
  if (!amt || amt <= 0) return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });

  const adm = await prisma.admission.findUnique({ where: { id: String(admissionId) } });
  if (!adm || (adm.email !== user.email && adm.id !== user.admissionId)) {
    return NextResponse.json({ error: "Admission not found" }, { status: 404 });
  }
  if (adm.status !== "approved") return NextResponse.json({ error: "Admission not approved yet" }, { status: 400 });
  const finalFee = adm.finalFee ?? adm.totalFee ?? 0;

  // Outstanding guard: acknowledged + in-flight (submitted/pending_verification) must not exceed fee
  const existing = await prisma.feePayment.findMany({
    where: { admissionId: adm.id, status: { in: ["submitted", "pending_verification", "acknowledged"] } },
  });
  const committed = existing.reduce((s, p) => s + p.amount, 0);
  if (committed + amt > finalFee) {
    return NextResponse.json({ error: `Exceeds outstanding ₹${(finalFee - committed).toLocaleString("en-IN")}` }, { status: 400 });
  }

  const txn = transactionId ? String(transactionId).trim() : "";
  let shot: string | null = null;
  if (screenshot) {
    try {
      shot = await uploadDataUrl("payment-proofs", String(screenshot), "proof");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Screenshot upload failed" }, { status: 400 });
    }
  }
  if (m === "upi" && (!txn || !shot)) return NextResponse.json({ error: "UPI needs transaction ID + screenshot" }, { status: 400 });
  if (m === "bank" && !txn) return NextResponse.json({ error: "Bank needs transaction ID" }, { status: 400 });

  let hint = note ? String(note).slice(0, 300) : null;
  if (installmentId) {
    const inst = await prisma.installment.findUnique({ where: { id: String(installmentId) } });
    if (inst && inst.admissionId === adm.id) {
      hint = `${hint ? hint + " " : ""}[for ${inst.label}]`;
    }
  }

  const pay = await prisma.feePayment.create({
    data: {
      admissionId: adm.id,
      studentId: user.id,
      amount: amt,
      method: m,
      transactionId: txn || null,
      screenshot: shot,
      status: "submitted",
      recordedBy: user.email,
      note: hint,
    },
  });
  await audit("payment", pay.id, user.email, "payment_submitted", `${m} ₹${amt} for ${adm.applicationId || adm.id}`);
  try { const tpl = tplPaymentAck(adm, pay, "pending_verification"); sendEmail({ to: adm.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); } catch {}
  return NextResponse.json({ ok: true, payment: pay });
}
