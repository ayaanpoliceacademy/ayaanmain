// Central SMTP email — env-driven, safe to call even when SMTP not configured (logs and returns ok:false)
import nodemailer from "nodemailer";

type SendOpts = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  cc?: string;
  bcc?: string;
};

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 0);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure = String(process.env.SMTP_SECURE || "").toLowerCase() === "true" || port === 465;
  if (!host || !port || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // allow custom SMTP without strict cert issues on some hosts
    tls: { rejectUnauthorized: false },
  });
}

function fromAddr(): string {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER || "no-reply@ayaaninstitute.in";
  const name = process.env.SMTP_FROM_NAME || "Ayaan Institute";
  // if from already contains <>, return as-is
  if (from.includes("<")) return from;
  return `"${name}" <${from}>`;
}

export async function sendEmail(opts: SendOpts): Promise<{ ok: boolean; id?: string; error?: string; skipped?: boolean }> {
  const transporter = getTransporter();
  if (!transporter) {
    console.log(`[email:skip] SMTP not configured — would send to ${opts.to}: ${opts.subject}`);
    return { ok: false, skipped: true, error: "SMTP not configured (set SMTP_HOST/PORT/USER/PASS in env)" };
  }
  try {
    // verify connectivity once (cached by nodemailer)
    try { await transporter.verify(); } catch {}
    const info = await transporter.sendMail({
      from: fromAddr(),
      to: opts.to,
      cc: opts.cc,
      bcc: opts.bcc,
      subject: opts.subject,
      text: opts.text || opts.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 4000),
      html: wrapHtml(opts.subject, opts.html),
    });
    console.log(`[email:sent] ${opts.to} :: ${opts.subject} id=${info.messageId}`);
    return { ok: true, id: info.messageId };
  } catch (e: any) {
    console.error(`[email:fail] ${opts.to} :: ${e.message}`);
    return { ok: false, error: e.message || "Email failed" };
  }
}

export async function sendBulk(toList: string[], subject: string, html: string, opts?: { cc?: string; bcc?: string }): Promise<{ ok: boolean; sent: number; failed: number; errors: string[] }> {
  let sent = 0, failed = 0;
  const errors: string[] = [];
  // send sequentially to respect rate limits on custom SMTP
  for (const to of toList) {
    const r = await sendEmail({ to, subject, html, cc: opts?.cc, bcc: opts?.bcc });
    if (r.ok) sent++; else { failed++; if (r.error) errors.push(`${to}: ${r.error}`); }
    // small throttle
    await new Promise((res) => setTimeout(res, 120));
  }
  return { ok: failed === 0, sent, failed, errors };
}

function wrapHtml(subject: string, body: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
  <style>
    body{font-family:Inter,system-ui,Arial,sans-serif;background:#f8fafc;margin:0;padding:0;color:#0f172a}
    .wrap{max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0}
    .header{background:#0f172a;color:#fff;padding:18px 24px}
    .header h1{margin:0;font-size:18px;letter-spacing:0.06em} .header h1 span{color:#38bdf8}
    .header p{margin:4px 0 0;font-size:11px;opacity:0.7}
    .body{padding:20px 24px;line-height:1.6;font-size:14px;color:#334155}
    .body h2{margin:0 0 10px;font-size:16px;color:#0f172a}
    .cta{display:inline-block;margin-top:12px;padding:10px 18px;background:#0f172a;color:#fff !important;text-decoration:none;border-radius:999px;font-weight:600;font-size:13px}
    .meta{margin-top:16px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;color:#64748b}
    .footer{padding:14px 24px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:11px;color:#64748b;text-align:center}
    .footer a{color:#0369a1}
    a{color:#0369a1}
  </style></head><body><div class="wrap">
    <div class="header"><h1>AYAAN <span>INSTITUTE</span></h1><p>Group of Competitive Institutions • Warangal • Hanamkonda • Hyderabad • +91 88866 67222</p></div>
    <div class="body">${body}</div>
    <div class="footer">Ayaan Institute • Don Bosco School, Opp. Vaagdevi College, Bollikunta, Warangal 506005 • <a href="https://ayaaninstitute.in">ayaaninstitute.in</a> • <a href="mailto:ayaaninstitute.wgl@gmail.com">ayaaninstitute.wgl@gmail.com</a><br/>You received this because you applied / study at Ayaan. Reply to this email for help.</div>
  </div></body></html>`;
}

// ---- Templates for admission/payment flows ----
export function tplAdmissionSubmitted(a: any): { subject: string; html: string } {
  return {
    subject: `Application received — ${a.applicationId} • ${a.course} • Ayaan`,
    html: `<h2>Hi ${esc(a.name)}, your application is in review</h2>
      <p>Thanks for applying to <b>${esc(a.course)}</b> at <b>${esc(a.branch)}</b>.</p>
      <div class="meta"><b>Application ID:</b> ${esc(a.applicationId)}<br/><b>Course:</b> ${esc(a.course)} • ${esc(a.courseType || "")} • ${esc(a.medium || "")} • ${esc(a.mode || "")}<br/><b>Duration:</b> ${esc(a.durationName || "")} • <b>Batch:</b> ${esc(a.batchName || a.batchId || "To be assigned")}<br/><b>Total Fee:</b> ₹${Number(a.totalFee || 0).toLocaleString("en-IN")} • <b>Paid:</b> ₹${Number(a.payingNow || 0).toLocaleString("en-IN")} • <b>Balance:</b> ₹${Number(a.balanceDue || 0).toLocaleString("en-IN")}</div>
      <p>Current status: <b>Pending Review</b>. No login is created yet — you'll get an email with your Student ID and temporary password once admin approves.</p>
      ${a.clarificationToken ? `<p>Keep this private correction link (if admin asks for changes):<br/><a href="${esc(process.env.NEXT_PUBLIC_SITE_URL || "https://ayaaninstitute.in")}/apply/correct?token=${esc(a.clarificationToken)}">Correct my application</a></p>` : ""}
      <p><a class="cta" href="${esc(process.env.NEXT_PUBLIC_SITE_URL || "https://ayaaninstitute.in")}/login">Track Application</a></p>
      <p style="font-size:12px;color:#64748b">Query? Reply or call +91 88866 67222.</p>`,
  };
}

export function tplAdmissionApproved(a: any, creds: { studentId: string; email: string; tempPassword: string }): { subject: string; html: string } {
  return {
    subject: `Welcome to Ayaan — Student ID ${creds.studentId} • Login active`,
    html: `<h2>Welcome, ${esc(a.name)} — you're now a student 🎉</h2>
      <p>Your admission is <b>Approved</b>.</p>
      <div class="meta"><b>Student ID:</b> ${esc(creds.studentId)}<br/><b>Course:</b> ${esc(a.course)} • <b>Branch:</b> ${esc(a.branch)}<br/><b>Batch:</b> ${esc(a.batchName || a.batchId || "—")}<br/><b>Fee locked:</b> ₹${Number(a.finalFee ?? a.totalFee ?? 0).toLocaleString("en-IN")}</div>
      <p>Login with your email and temporary password (you must change it on first login):</p>
      <div class="meta"><b>Email:</b> ${esc(creds.email)}<br/><b>Temporary password:</b> <code>${esc(creds.tempPassword)}</code></div>
      <p><a class="cta" href="${esc(process.env.NEXT_PUBLIC_SITE_URL || "https://ayaaninstitute.in")}/login">Login to your account</a></p>
      <p style="font-size:12px;color:#64748b">This password is auto-generated and valid for first login only. Change it immediately after login.</p>`,
  };
}

export function tplAdmissionRejected(a: any, note?: string): { subject: string; html: string } {
  return {
    subject: `Update on your application ${a.applicationId} — Ayaan`,
    html: `<h2>Hi ${esc(a.name)}</h2><p>Your application <b>${esc(a.applicationId)}</b> has been <b>Rejected</b>.</p>${note ? `<div class="meta"><b>Note:</b> ${esc(note)}</div>` : ""}<p>If you believe this is a mistake, reply to this email or call +91 88866 67222.</p>`,
  };
}

export function tplClarification(a: any, note: string): { subject: string; html: string } {
  const link = `${esc(process.env.NEXT_PUBLIC_SITE_URL || "https://ayaaninstitute.in")}/apply/correct?token=${esc(a.clarificationToken || "")}`;
  return {
    subject: `Action needed — update your application ${a.applicationId}`,
    html: `<h2>Hi ${esc(a.name)}, please update your application</h2><p>Admin requested a correction:</p><div class="meta">${esc(note)}</div><p><a class="cta" href="${link}">Correct my application</a></p><p style="font-size:12px;color:#64748b">Link: ${link}</p>`,
  };
}

export function tplPaymentAck(a: any, payment: any, status: "pending_verification" | "acknowledged" | "rejected" | "failed", note?: string): { subject: string; html: string } {
  const labels: Record<string, string> = { pending_verification: "Received — pending verification", acknowledged: "Acknowledged ✓", rejected: "Rejected", failed: "Failed" };
  return {
    subject: `Payment ${labels[status] || status} — ₹${Number(payment.amount).toLocaleString("en-IN")} • ${a.applicationId || a.course}`,
    html: `<h2>Hi ${esc(a.name)}</h2><p>Your payment of <b>₹${Number(payment.amount).toLocaleString("en-IN")}</b> via <b>${esc(payment.method)}</b> is <b>${esc(labels[status] || status)}</b>.</p>
      <div class="meta"><b>Application:</b> ${esc(a.applicationId || a.id)}<br/><b>Amount:</b> ₹${Number(payment.amount).toLocaleString("en-IN")}<br/><b>Method:</b> ${esc(payment.method)} ${payment.transactionId ? "• <b>Txn:</b> " + esc(payment.transactionId) : ""}<br/><b>Status:</b> ${esc(status)}${note ? "<br/><b>Note:</b> " + esc(note) : ""}</div>
      ${status === "acknowledged" ? `<p>Your receipt has been generated. Check <a href="${esc(process.env.NEXT_PUBLIC_SITE_URL || "https://ayaaninstitute.in")}/account">My Account → Receipts</a>.</p>` : status === "rejected" ? `<p>Please contact support or repay with correct details.</p>` : ""}
      <p style="font-size:12px;color:#64748b">Query? Reply or call +91 88866 67222.</p>`,
  };
}

export function tplDiscount(a: any, action: "requested" | "approved" | "rejected", amount?: number): { subject: string; html: string } {
  if (action === "requested") return { subject: `Discount requested — ₹${Number(amount || a.discount || 0).toLocaleString("en-IN")} • ${a.applicationId}`, html: `<h2>Hi ${esc(a.name)}</h2><p>A discount of <b>₹${Number(amount || a.discount || 0).toLocaleString("en-IN")}</b> has been requested for <b>${esc(a.applicationId)}</b> and is pending super-admin approval.</p><div class="meta"><b>Total after discount (proposed):</b> ₹${Number(a.totalFee || 0).toLocaleString("en-IN")}</div>` };
  if (action === "approved") return { subject: `Discount approved — ₹${Number(amount || a.discount || 0).toLocaleString("en-IN")} • ${a.applicationId}`, html: `<h2>Great news, ${esc(a.name)}</h2><p>Your discount of <b>₹${Number(amount || a.discount || 0).toLocaleString("en-IN")}</b> is <b>Approved</b> and your fee is now locked at <b>₹${Number(a.finalFee ?? a.totalFee ?? 0).toLocaleString("en-IN")}</b>.</p>` };
  return { subject: `Discount update — ${a.applicationId}`, html: `<h2>Hi ${esc(a.name)}</h2><p>Your discount request for <b>${esc(a.applicationId)}</b> was <b>Rejected</b>.</p><div class="meta">Current fee remains ₹${Number(a.totalFee || 0).toLocaleString("en-IN")}</div>` };
}

function esc(s: any): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
