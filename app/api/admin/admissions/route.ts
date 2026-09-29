import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { requireAdminSession } from "@/lib/auth-helpers";
import { prisma } from "@/lib/prisma";
import { supabaseAdmin } from "@/lib/supabase";
import { newStudentId, newDigitalIdNo, addMonths, audit } from "@/lib/identifiers";
import { sendEmail, tplClarification, tplDiscount, tplAdmissionApproved, tplAdmissionRejected } from "@/lib/email";

function generateInitialPassword(): string {
  // 12-char random, e.g. Ayaan@A1B2C3 — per-student, not shared
  const rand = crypto.randomBytes(6).toString("base64url").slice(0, 6).toUpperCase();
  return `Ayaan@${rand}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const admissions = await prisma.admission.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(admissions, { headers: { "Cache-Control": "no-store" } });
}

async function txCounter(tx: any, kind: string): Promise<{ year: number; seq: number }> {
  const year = new Date().getFullYear();
  const key = `${kind}:${year}`;
  const rec = await tx.counter.upsert({
    where: { key },
    update: { seq: { increment: 1 } },
    create: { key, seq: 1 },
  });
  return { year, seq: rec.seq };
}

export async function POST(req: NextRequest) {
  const auth = await requireAdminSession(req, ["super_admin", "admissions"]);
  if (auth.error) return auth.error;
  const actor = String(auth.session.username || auth.session.name || "admin");
  const isSuper = auth.session.role === "super_admin";
  const body = await req.json();
  const { action, id } = body;
  if (!action || !id) return NextResponse.json({ error: "action and id required" }, { status: 400 });

  const admission = await prisma.admission.findUnique({ where: { id } });
  if (!admission) return NextResponse.json({ error: "Admission not found" }, { status: 404 });

  // ---- Clarification ----
  if (action === "request_clarification") {
    const note = String(body.note || "").trim().slice(0, 1000);
    if (!note) return NextResponse.json({ error: "Clarification note required" }, { status: 400 });
    if (admission.status === "approved") return NextResponse.json({ error: "Already approved" }, { status: 400 });
    const token = admission.clarificationToken || crypto.randomBytes(24).toString("hex");
    await prisma.admission.update({
      where: { id },
      data: { status: "clarification_required", clarificationNote: note, clarificationToken: token },
    });
    await audit("admission", id, actor, "clarification_requested", note);
    try { const upd = await prisma.admission.findUnique({ where: { id }}); if (upd) { const tpl = tplClarification(upd, note); sendEmail({ to: upd.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); } } catch {}
    return NextResponse.json({ ok: true, token });
  }

  // ---- Discount flow ----
  if (action === "apply_discount") {
    const discount = Math.max(0, Math.round(Number(body.discount || 0)));
    if (admission.status === "approved") return NextResponse.json({ error: "Already approved — fee locked" }, { status: 400 });
    const totalFee = Math.max(0, (admission.amount || 0) + (admission.addonFees || 0) - discount);
    if (isSuper) {
      await prisma.admission.update({
        where: { id },
        data: { discount, discountStatus: "approved", totalFee, finalFee: totalFee, feeLocked: true, balanceDue: Math.max(0, totalFee - (admission.payingNow || 0)) },
      });
      await audit("admission", id, actor, "discount_approved", `Discount ₹${discount} applied & fee locked at ₹${totalFee}`);
      try { const upd = await prisma.admission.findUnique({ where: { id }}); if (upd) { const tpl = tplDiscount(upd, "approved", discount); sendEmail({ to: upd.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); } } catch {}
      return NextResponse.json({ ok: true, locked: true, totalFee });
    }
    await prisma.admission.update({
      where: { id },
      data: { discount, discountStatus: "requested", status: "discount_pending", totalFee, balanceDue: Math.max(0, totalFee - (admission.payingNow || 0)) },
    });
    await audit("admission", id, actor, "discount_requested", `Discount ₹${discount} requested — needs super_admin approval`);
    try { const upd = await prisma.admission.findUnique({ where: { id }}); if (upd) { const tpl = tplDiscount(upd, "requested", discount); sendEmail({ to: upd.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); } } catch {}
    return NextResponse.json({ ok: true, locked: false, totalFee });
  }

  if (action === "approve_discount" || action === "reject_discount") {
    if (!isSuper) return NextResponse.json({ error: "Only super_admin can approve discounts" }, { status: 403 });
    if (admission.discountStatus !== "requested") return NextResponse.json({ error: "No discount pending approval" }, { status: 400 });
    if (action === "reject_discount") {
      const totalFee = (admission.amount || 0) + (admission.addonFees || 0);
      await prisma.admission.update({
        where: { id },
        data: { discount: 0, discountPercent: 0, discountStatus: "rejected", status: "pending", totalFee, balanceDue: Math.max(0, totalFee - (admission.payingNow || 0)) },
      });
      await audit("admission", id, actor, "discount_rejected", "Discount request rejected");
      try { const upd = await prisma.admission.findUnique({ where: { id }}); if (upd) { const tpl = tplDiscount(upd, "rejected"); sendEmail({ to: upd.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); } } catch {}
      return NextResponse.json({ ok: true });
    }
    const totalFee = Math.max(0, (admission.amount || 0) + (admission.addonFees || 0) - (admission.discount || 0));
    await prisma.admission.update({
      where: { id },
      data: { discountStatus: "approved", status: "pending", totalFee, finalFee: totalFee, feeLocked: true, balanceDue: Math.max(0, totalFee - (admission.payingNow || 0)) },
    });
    await audit("admission", id, actor, "discount_approved", `Fee locked at ₹${totalFee}`);
    try { const upd = await prisma.admission.findUnique({ where: { id }}); if (upd) { const tpl = tplDiscount(upd, "approved"); sendEmail({ to: upd.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); } } catch {}
    return NextResponse.json({ ok: true, totalFee });
  }

  // ---- Approve: full workflow ----
  if (action === "approve") {
    if (admission.status === "approved") return NextResponse.json({ error: "Already approved" }, { status: 400 });
    if (!["pending"].includes(admission.status)) {
      return NextResponse.json({ error: `Cannot approve from status ${admission.status} — resolve clarification/discount first` }, { status: 400 });
    }
    if (admission.discountStatus === "requested") {
      return NextResponse.json({ error: "Discount pending super_admin approval" }, { status: 400 });
    }
    const existing = await prisma.user.findUnique({ where: { email: admission.email.toLowerCase() } });
    if (existing) return NextResponse.json({ error: "User already exists for this email" }, { status: 400 });

    // Optional admin override of start date / batch
    const batchId = body.batchId ? String(body.batchId) : admission.batchId;
    if (!batchId) return NextResponse.json({ error: "Batch required for approval" }, { status: 400 });

    // 1. Create Supabase Auth user with per-student random initial password (outside DB tx)
    const initialPassword = generateInitialPassword();
    const { data: supaData, error: supaError } = await supabaseAdmin.auth.admin.createUser({
      email: admission.email.toLowerCase(),
      password: initialPassword,
      email_confirm: true,
      user_metadata: { name: admission.name, phone: admission.phone, course: admission.course },
    });
    let supabaseId: string | null = supaData?.user?.id || null;
    if (supaError) {
      if (supaError.message.includes("already exists") || supaError.message.includes("already registered")) {
        const { data: list } = await supabaseAdmin.auth.admin.listUsers();
        const found = list?.users.find((u) => u.email?.toLowerCase() === admission.email.toLowerCase());
        if (!found) return NextResponse.json({ error: `Supabase error: ${supaError.message}` }, { status: 400 });
        // Reset to a fresh random password so first-login rule holds
        await supabaseAdmin.auth.admin.updateUserById(found.id, { password: initialPassword });
        supabaseId = found.id;
      } else {
        return NextResponse.json({ error: `Supabase error: ${supaError.message}` }, { status: 400 });
      }
    }

    // 2. DB transaction with batch row lock (prevents overbooking)
    try {
      const result = await prisma.$transaction(async (tx) => {
        const locked: any[] = await tx.$queryRaw`SELECT * FROM batches WHERE id = ${batchId} FOR UPDATE`;
        const b = locked[0];
        if (!b) throw new Error("Batch not found");
        if (!b.isActive || b.status !== "open") throw new Error("Batch is not active");
        if (Number(b.filled) >= Number(b.seats)) throw new Error(`Batch is full (${b.filled}/${b.seats})`);

        const startDate = body.admissionStartDate ? new Date(body.admissionStartDate) : admission.admissionStartDate ? new Date(admission.admissionStartDate) : new Date(b.startDate);
        const months = admission.durationMonths || 3;
        const endDate = addMonths(startDate, months);

        const { year: sy, seq: ss } = await txCounter(tx, "stu");
        const studentId = `AYN-STU-${sy}-${String(ss).padStart(6, "0")}`;
        const { year: dy, seq: ds } = await txCounter(tx, "did");
        const digitalIdNo = `AYN-DID-${dy}-${String(ds).padStart(6, "0")}`;

        const finalFee = admission.feeLocked && admission.finalFee != null ? admission.finalFee : (admission.totalFee ?? 0);

        const user = await tx.user.create({
          data: {
            name: admission.name,
            fatherName: admission.fatherName,
            phone: admission.phone,
            email: admission.email.toLowerCase(),
            address: admission.address,
            reference: admission.reference,
            branch: admission.branch,
            course: admission.course,
            courseType: admission.courseType,
            medium: admission.medium,
            mode: admission.mode,
            supabaseId,
            admissionId: id,
            studentId,
            digitalIdNo,
            digitalIdValidFrom: startDate,
            digitalIdValidUntil: endDate,
            digitalIdStatus: "active",
            mustChangePassword: true,
            isActive: true,
          },
        });

        await tx.admission.update({
          where: { id },
          data: {
            status: "approved",
            approvedAt: new Date(),
            applicantStudentId: studentId,
            studentId: user.id,
            batchId,
            batchName: b.name || `${b.course} • ${b.slot || b.mode}`,
            admissionStartDate: startDate,
            courseEndDate: endDate,
            finalFee,
            feeLocked: true,
          },
        });

        await tx.batch.update({ where: { id: batchId }, data: { filled: { increment: 1 } } });

        // Migrate registration splits → FeePayment (pending verification)
        const splits = await tx.admissionPayment.findMany({ where: { admissionId: id } });
        for (const s of splits) {
          await tx.feePayment.create({
            data: {
              admissionId: id,
              studentId: user.id,
              amount: s.amount,
              method: s.method,
              transactionId: s.transactionId,
              screenshot: s.screenshot,
              status: "pending_verification",
              recordedBy: s.recordedBy,
              note: "Registration split — verify & acknowledge",
            },
          });
        }

        // Default schedule: single installment for full balance (admin may redefine)
        const paidSoFar = splits.reduce((sum, x) => sum + x.amount, 0);
        const balance = Math.max(0, finalFee - paidSoFar);
        const inst = await tx.installment.create({
          data: {
            admissionId: id,
            studentId: user.id,
            seq: 1,
            label: "Installment 1",
            originalAmount: finalFee,
            paidAmount: 0,
            dueDate: addMonths(startDate, 1),
            status: balance <= 0 ? "paid" : "pending",
            notes: "Auto-created at approval — admin may redefine the schedule",
          },
        });

        return { user, studentId, digitalIdNo, startDate, endDate, finalFee, balance };
      });

      await audit("admission", id, actor, "admission_approved", `Student ${result.studentId}, fee locked ₹${result.finalFee}`);
      await audit("user", result.user.id, actor, "student_account_created", `Login ${result.user.email}, initial password + must-change`);
      try { const upd = await prisma.admission.findUnique({ where: { id }}); if (upd) { const tpl = tplAdmissionApproved(upd, { studentId: result.studentId, email: result.user.email, tempPassword: initialPassword }); sendEmail({ to: upd.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); } } catch {}
      return NextResponse.json({
        ok: true,
        studentId: result.studentId,
        digitalIdNo: result.digitalIdNo,
        user: { id: result.user.id, email: result.user.email, name: result.user.name },
        admissionStartDate: result.startDate,
        courseEndDate: result.endDate,
        finalFee: result.finalFee,
        initialPassword,
      });
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Approval failed" }, { status: 400 });
    }
  }

  if (action === "reject") {
    await prisma.admission.update({ where: { id }, data: { status: "rejected", rejectedAt: new Date() } });
    await audit("admission", id, actor, "application_rejected");
    try { const upd = await prisma.admission.findUnique({ where: { id }}); if (upd) { const tpl = tplAdmissionRejected(upd); sendEmail({ to: upd.email, subject: tpl.subject, html: tpl.html }).catch(()=>{}); } } catch {}
    return NextResponse.json({ ok: true });
  }

  if (action === "pending") {
    await prisma.admission.update({ where: { id }, data: { status: "pending" } });
    await audit("admission", id, actor, "application_reopened");
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
