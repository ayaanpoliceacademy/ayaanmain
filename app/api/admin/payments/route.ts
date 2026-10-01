import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { scopeFromAuth, resolveBranchFilter, keepBranch, canActOn, forbidBranch, allowedBranches } from "@/lib/branch-scope";

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;
  const body = await req.json();
  const { name, phone, email, course, medium, mode, amount, paidAmount, dueDate, paymentMethod, transactionId, studentId, createStudent, password, fatherName, address, branch, courseType } = body;
  if (!name || !phone || !email || !course || !amount) return NextResponse.json({ error: "name, phone, email, course, amount required" }, { status: 400 });
  if (!/^[0-9]{10}$/.test(String(phone))) return NextResponse.json({ error: "phone must be 10 digits" }, { status: 400 });

  let user = await prisma.user.findFirst({
    where: { OR: [{ email: String(email).toLowerCase() }, { phone: String(phone) }] },
  });
  let createdUserId: string | null = null;
  let generatedPassword: string | null = null;
  if (!user && (createStudent || studentId === "new")) {
    const pw = String(password || "").trim() || `Ayaan@${crypto.randomBytes(3).toString("hex").slice(0, 6).toUpperCase()}`;
    if (pw.length < 8) return NextResponse.json({ error: "Password min 6 chars for new student" }, { status: 400 });

    // Create Supabase Auth user
    const { data: supaData, error: supaError } = await supabaseAdmin.auth.admin.createUser({
      email: String(email).trim().toLowerCase(),
      password: pw,
      email_confirm: true,
      user_metadata: { name: String(name).trim(), phone: String(phone).trim(), course: String(course) },
    });
    if (supaError) return NextResponse.json({ error: `Supabase error: ${supaError.message}` }, { status: 400 });

    user = await prisma.user.create({
      data: {
        name: String(name).trim(),
        fatherName: String(fatherName || "").trim(),
        email: String(email).trim().toLowerCase(),
        phone: String(phone).trim(),
        address: String(address || "").trim(),
        branch: String(branch || ""),
        course: String(course),
        courseType: String(courseType || "Regular"),
        medium: String(medium || "Telugu"),
        mode: String(mode || "Offline"),
        supabaseId: supaData.user.id,
        isActive: true,
      },
    });
    createdUserId = user.id;
    generatedPassword = pw;
  } else if (studentId && studentId !== "new") {
    const existing = await prisma.user.findUnique({ where: { id: studentId } });
    if (existing) createdUserId = existing.id;
  }

  const fee = Number(amount);
  const paid = paidAmount !== undefined && paidAmount !== "" ? Math.min(Number(amount), Number(paidAmount)) : Number(amount);
  const id = `PAY-${Date.now()}-${Math.random().toString(36).slice(2, 4).toUpperCase()}`;

  // Campus scoping: a campus admin may only record fees for their own campuses
  const scope = scopeFromAuth(auth);
  const targetBranch = String(body.branch || (user ? (user as any).branch : "") || branch || "").trim();
  if (!canActOn(scope, targetBranch)) return forbidBranch(targetBranch);

  const entry = await prisma.payment.create({
    data: {
      id,
      admissionId: id,
      studentId: createdUserId || (user ? user.id : null),
      name: String(name).trim(),
      phone: String(phone).trim(),
      email: String(email).trim().toLowerCase(),
      course: String(course),
      medium: String(medium || "Telugu"),
      mode: String(mode || "Offline"),
      branch: targetBranch,
      amount: fee,
      paidAmount: paid,
      dueDate: dueDate ? new Date(dueDate) : null,
      paymentMethod: String(paymentMethod || "cash").toLowerCase(),
      transactionId: transactionId ? String(transactionId).trim() : null,
      screenshot: null,
      status: paidAmount !== undefined && Number(paidAmount) < Number(amount) ? "pending" : "approved",
      approvedAt: Number(paidAmount) >= Number(amount) ? new Date() : null,
    },
  });

  return NextResponse.json({ ok: true, id: entry.id, studentId: createdUserId, generatedPassword });
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "finance"]);
  if (auth.error) return auth.error;

  // Campus scoping: restrict to the admin's assigned campuses, then apply the ?branch= filter
  const scope = scopeFromAuth(auth);
  const { searchParams } = new URL(req.url);
  const branchFilter = resolveBranchFilter(scope, searchParams.get("branch"));
  if (branchFilter.error) return NextResponse.json({ error: branchFilter.error }, { status: 403 });
  const only = branchFilter.branch ? [branchFilter.branch] : null;

  // Unified source: legacy manual payments + admission-flow fee payments.
  // Registration splits become fee_payments (pending_verification) at submit and
  // acknowledged ones (with receipts) after admin approval — both must show here.
  const [payments, feePayments, usersCount] = await Promise.all([
    prisma.payment.findMany({ where: only ? { branch: { in: only } } : {}, orderBy: { createdAt: "desc" }, take: 2000 }),
    prisma.feePayment.findMany({
      orderBy: { createdAt: "desc" },
      take: 2000,
      include: { receipt: true },
    }),
    prisma.user.count(),
  ]);

  // Batch-load related admissions + users for fee payment mapping (no N+1, skipped when empty)
  const admIds = Array.from(new Set(feePayments.map((p) => p.admissionId).filter(Boolean)));
  const stuIds = Array.from(new Set(feePayments.map((p) => String(p.studentId || "")).filter(Boolean)));
  const [adms, users] = feePayments.length === 0 ? [[], []] : await Promise.all([
    admIds.length > 0 ? prisma.admission.findMany({ where: { id: { in: admIds } }, select: { id: true, name: true, email: true, phone: true, course: true, medium: true, mode: true, branch: true } }) : Promise.resolve([]),
    stuIds.length > 0 ? prisma.user.findMany({ where: { id: { in: stuIds } }, select: { id: true, name: true, email: true, phone: true, course: true, medium: true, mode: true, branch: true } }) : Promise.resolve([]),
  ]);
  const admById = new Map(adms.map((a: any) => [a.id, a]));
  const userById = new Map(users.map((u: any) => [u.id, u]));

  const feeMapped = feePayments.map((p: any) => {
    const a = admById.get(p.admissionId);
    const u = userById.get(String(p.studentId || ""));
    const acked = p.status === "acknowledged";
    const dead = p.status === "rejected" || p.status === "failed";
    const amount = Number(p.amount || 0);
    return {
      id: p.id,
      admissionId: p.admissionId,
      student: u?.name || a?.name || "—",
      email: u?.email || a?.email || "",
      phone: u?.phone || a?.phone || "",
      course: a?.course || u?.course || "",
      branch: a?.branch || u?.branch || "",
      medium: a?.medium || u?.medium || "",
      mode: a?.mode || u?.mode || "",
      amount,
      paidAmount: acked ? amount : 0,
      balance: acked ? 0 : amount,
      paymentMethod: p.method,
      transactionId: p.transactionId,
      status: acked ? "collected" : p.status,
      collected: acked ? amount : 0,
      receivable: dead ? 0 : amount,
      createdAt: p.createdAt.toISOString(),
      dueDate: null,
      screenshot: !!p.screenshot,
      approved: acked,
      src: "fee",
      receiptNo: p.receiptNo || p.receipt?.receiptNo || null,
      note: p.note || null,
    };
  });

  // Campus scope: fee payments carry the admission's campus, so filter after mapping.
  // A requested ?branch= must narrow these too — otherwise a drill-down still shows every campus.
  const scopedFee = keepBranch(
    feeMapped,
    only ? { branches: only } : scope,
    (p: any) => p.branch,
  );

  const formatted = [...payments.map((p: any) => {
    const fee = p.amount;
    const paidAmount = p.paidAmount;
    const isPaid = paidAmount >= fee;
    const balance = Math.max(0, fee - paidAmount);
    return {
      id: p.id,
      admissionId: p.admissionId,
      student: p.name,
      email: p.email,
      phone: p.phone,
      course: p.course,
      branch: p.branch || "",
      medium: p.medium,
      mode: p.mode,
      amount: fee,
      paidAmount,
      balance,
      paymentMethod: p.paymentMethod,
      transactionId: p.transactionId,
      status: isPaid ? "collected" : balance > 0 && balance < fee ? "partial" : p.status === "pending" && p.paymentMethod === "cash" ? "pending_cash" : p.paymentMethod !== "cash" && p.transactionId ? "pending_verification" : "pending",
      collected: paidAmount,
      receivable: fee,
      createdAt: p.createdAt.toISOString(),
      dueDate: p.dueDate?.toISOString() || null,
      screenshot: !!p.screenshot,
      approved: p.status === "approved",
      src: "legacy",
    };
  }), ...scopedFee].sort((a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  const totalReceivable = formatted.reduce((s: number, p: any) => s + p.receivable, 0);
  const totalCollected = formatted.reduce((s: number, p: any) => s + p.collected, 0);
  const totalPending = totalReceivable - totalCollected;

  return NextResponse.json({ payments: formatted, totals: { totalReceivable, totalCollected, totalPending, count: formatted.length }, usersCount }, { headers: { "Cache-Control": "no-store" } });
}
