import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { uploadDataUrl } from "@/lib/storage";
import { newApplicationId, addMonths, audit } from "@/lib/identifiers";
import { fallbackFee } from "@/lib/fees";
import { isEmail, isPhone, sanitizeText } from "@/lib/validators";
import { rateLimit, getClientIp } from "@/lib/rateLimit";
import { sendEmail, tplAdmissionSubmitted } from "@/lib/email";
async function getFee(course: string, mode: string, duration?: string, medium?: string, branch?: string) {
  try {
    // Lookup order: exact → peel branch → peel medium → peel duration → Base ("","","") → hardcoded fallback
    const d = duration || "", m = medium || "", b = branch || "";
    const chain: [string, string, string][] = [[d, m, b], [d, m, ""], [d, "", ""], ["", "", ""]];
    const seen = new Set<string>();
    for (const [dd, mm, bb] of chain) {
      const key = `${dd}|${mm}|${bb}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hit = await prisma.feeConfig.findUnique({ where: { course_mode_duration_medium_branch: { course, mode, duration: dd, medium: mm, branch: bb } } });
      if (hit) return hit.amount;
    }
  } catch {}
  return fallbackFee(course, mode);
}

const SPLIT_METHODS = ["cash", "upi", "bank", "razorpay"];

export async function POST(req: NextRequest) {
  // Rate limit public admissions: 5 per 15 min per IP
  const ip = getClientIp(req);
  const rl = rateLimit(`admissions:${ip}`, 5, 15 * 60 * 1000);
  if (!rl.allowed) return NextResponse.json({ error: "Too many applications — try again later" }, { status: 429, headers: { "Retry-After": String(Math.ceil(rl.resetMs / 1000)) } });

  const body = await req.json();
  // Honeypot for bots — if filled, silently reject as success to avoid probing
  if (body.website || body.honeypot || body.url) return NextResponse.json({ ok: true, id: "HP-" + Date.now(), applicationId: "HP", status: "pending" });

  const { name, fatherName, phone, email, address, reference, aadharCardNumber, branch, course, courseType, medium, mode, batchId, durationId, addonIds, photo, payments } = body;

  if (!name || !fatherName || !phone || !email || !address || !branch || !course || !aadharCardNumber) return NextResponse.json({ error: "name, fatherName, phone, email, address, aadhar, branch, course required" }, { status: 400 });
  if (!isPhone(String(phone))) return NextResponse.json({ error: "phone must be 10 digits" }, { status: 400 });
  if (!isEmail(String(email))) return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  if (!/^[0-9]{12}$/.test(String(aadharCardNumber).trim())) return NextResponse.json({ error: "Aadhar must be 12 digits" }, { status: 400 });

  // Branch validation — must exist and be active (admin Masters → Branches)
  if (branch) {
    const br = await prisma.branch.findFirst({ where: { name: String(branch).trim(), active: true } });
    if (!br) return NextResponse.json({ error: "Invalid or inactive branch — please select from available branches" }, { status: 400 });
  }
  // Medium validation — must exist and be active
  if (medium) {
    const m = await prisma.medium.findFirst({ where: { name: String(medium).trim(), active: true } });
    if (!m) return NextResponse.json({ error: "Invalid or inactive medium" }, { status: 400 });
  }
  // Course validation — must exist in Course table (by slug or title, case-insensitive)
  if (course) {
    const c = String(course).trim();
    const exists = await prisma.course.findFirst({ where: { OR: [{ slug: c.toLowerCase() }, { title: c }, { slug: c }, { title: { equals: c, mode: "insensitive" } }] } });
    // Allow legacy short codes like "SI" that map to courseDetails title parentheses; fallback check against fee configs short codes
    if (!exists) {
      const legacyCourses = ["SI", "Constable", "Groups", "SSC GD", "Defence", "Army", "UPSC", "Online"];
      if (!legacyCourses.includes(c) && !legacyCourses.map((x) => x.toLowerCase()).includes(c.toLowerCase())) {
        return NextResponse.json({ error: `Invalid course: ${c}` }, { status: 400 });
      }
    }
  }

  // Duration (snapshot)
  let durationName = "3 Months";
  let durationMonths = 3;
  if (durationId) {
    const d = await prisma.duration.findUnique({ where: { id: String(durationId) } });
    if (!d || !d.active) return NextResponse.json({ error: "Invalid or inactive duration" }, { status: 400 });
    durationName = d.name;
    durationMonths = d.months;
  }

  // Batch validation: active + open + seats left (no seat hold — hold happens at approval)
  let batch: any = null;
  if (batchId) {
    batch = await prisma.batch.findUnique({ where: { id: String(batchId) } });
    if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 400 });
    if (!batch.isActive || batch.status !== "open") return NextResponse.json({ error: "Batch is not active" }, { status: 400 });
    if (batch.filled >= batch.seats) return NextResponse.json({ error: "Batch is full — choose another batch" }, { status: 400 });
  }

  // Add-ons validation: active + applicable, snapshot fees
  let addonRows: { addonId: string; name: string; fee: number }[] = [];
  if (Array.isArray(addonIds) && addonIds.length > 0) {
    const addons = await prisma.addon.findMany({ where: { id: { in: addonIds.map(String) } } });
    if (addons.length !== addonIds.length) return NextResponse.json({ error: "Invalid add-on selected" }, { status: 400 });
    for (const a of addons) {
      if (!a.active) return NextResponse.json({ error: `Add-on ${a.name} is not available` }, { status: 400 });
      if (a.courses.length > 0 && !a.courses.includes(String(course))) {
        return NextResponse.json({ error: `Add-on ${a.name} not applicable to ${course}` }, { status: 400 });
      }
      addonRows.push({ addonId: a.id, name: a.name, fee: a.fee });
    }
  }
  const addonFees = addonRows.reduce((s, a) => s + a.fee, 0);

  // Photo upload (optional but encouraged)
  let photoUrl: string | null = null;
  if (photo) {
    try {
      photoUrl = await uploadDataUrl("applicant-photos", String(photo), "photo");
    } catch (e: any) {
      return NextResponse.json({ error: e.message || "Photo upload failed" }, { status: 400 });
    }
  }

  const baseFee = await getFee(String(course), String(mode || "Residential"), durationName, String(medium || ""), String(branch || ""));
  // Registration never sets discount — discount goes through approval flow
  const totalFee = baseFee + addonFees;

  // Optional payment splits at registration (may be empty = pay later)
  type Split = { method: string; amount: number; transactionId: string | null; screenshot: string | null };
  const splits: Split[] = [];
  if (Array.isArray(payments) && payments.length > 0) {
    for (let i = 0; i < payments.length; i++) {
      const p = payments[i];
      const method = String(p.method || "").toLowerCase();
      if (!SPLIT_METHODS.includes(method)) return NextResponse.json({ error: `Split ${i + 1}: method must be cash|upi|bank|razorpay` }, { status: 400 });
      const amt = Math.round(Number(p.amount));
      if (!amt || amt <= 0) return NextResponse.json({ error: `Split ${i + 1}: amount must be > 0` }, { status: 400 });
      const txn = p.transactionId ? String(p.transactionId).trim() : "";
      let shot: string | null = null;
      if (p.screenshot) {
        try {
          shot = await uploadDataUrl("payment-proofs", String(p.screenshot), "proof");
        } catch (e: any) {
          return NextResponse.json({ error: `Split ${i + 1}: ${e.message}` }, { status: 400 });
        }
      }
      if (method === "upi") {
        if (!txn) return NextResponse.json({ error: `Split ${i + 1} (UPI): transaction ID required` }, { status: 400 });
        if (!shot) return NextResponse.json({ error: `Split ${i + 1} (UPI): screenshot required` }, { status: 400 });
      }
      if (method === "bank" && !txn) return NextResponse.json({ error: `Split ${i + 1} (Bank): transaction ID required` }, { status: 400 });
      splits.push({ method, amount: amt, transactionId: txn || null, screenshot: shot });
    }
  }
  const paidSum = splits.reduce((s, x) => s + x.amount, 0);
  if (paidSum > totalFee) return NextResponse.json({ error: `Split total exceeds fee ₹${totalFee.toLocaleString("en-IN")}` }, { status: 400 });
  const balance = totalFee - paidSum;

  // Dates: batch start defaults admission start; end = start + duration (snapshots)
  const startDate = batch ? new Date(batch.startDate) : new Date();
  const endDate = addMonths(startDate, durationMonths);

  const applicationId = await newApplicationId();
  const clarificationToken = crypto.randomBytes(24).toString("hex");
  const primary = splits[0];

  const entry = await prisma.admission.create({
    data: {
      id: `ADM-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      applicationId,
      clarificationToken,
      name: sanitizeText(String(name), 100),
      fatherName: sanitizeText(String(fatherName), 100),
      phone: String(phone).trim(),
      email: String(email).trim().toLowerCase(),
      address: sanitizeText(String(address), 500),
      reference: sanitizeText(String(reference || ""), 100),
      aadharCardNumber: String(aadharCardNumber).trim(),
      branch: sanitizeText(String(branch), 100),
      course: sanitizeText(String(course), 50),
      courseType: sanitizeText(String(courseType || "Regular"), 20),
      medium: sanitizeText(String(medium || "Telugu"), 20),
      mode: sanitizeText(String(mode || "Residential"), 20),
      batchId: batch ? batch.id : null,
      batchName: batch ? (batch.name || `${batch.course} • ${batch.slot || batch.mode}`) : null,
      durationId: durationId ? String(durationId) : null,
      durationName,
      durationMonths,
      admissionStartDate: startDate,
      courseEndDate: endDate,
      photo: photoUrl,
      paymentMethod: primary ? primary.method : "cash",
      transactionId: primary?.transactionId || null,
      screenshot: primary?.screenshot || null,
      amount: baseFee,
      feeAmount: baseFee,
      addonFees,
      discount: 0,
      discountPercent: 0,
      discountStatus: "none",
      totalFee,
      finalFee: null,
      feeLocked: false,
      payingNow: paidSum,
      balanceDue: balance,
      paidAmount: paidSum,
      status: "pending",
    },
  });

  if (addonRows.length > 0) {
    await prisma.applicationAddon.createMany({
      data: addonRows.map((a) => ({ admissionId: entry.id, addonId: a.addonId, name: a.name, fee: a.fee })),
    });
  }

  const rows = await Promise.all(
    splits.map((s) =>
      prisma.admissionPayment.create({
        data: { admissionId: entry.id, method: s.method, amount: s.amount, transactionId: s.transactionId, screenshot: s.screenshot, recordedBy: entry.email },
      })
    )
  );

  await audit("admission", entry.id, entry.email, "application_submitted", `Application ${applicationId}`);

  // Email — admission status (pending review) — fire-and-forget, never blocks the response
  try {
    const tpl = tplAdmissionSubmitted(entry);
    sendEmail({ to: entry.email, subject: tpl.subject, html: tpl.html }).catch(() => {});
  } catch {}

  // NOTE: no user/student account is created here — only after admin approval.
  // correctionToken is returned once so the applicant can save their correction link (no portal access).
  return NextResponse.json({ ok: true, id: entry.id, applicationId, correctionToken: clarificationToken, status: "pending", totalFee, payingNow: paidSum, balanceDue: balance, payments: rows });
}
