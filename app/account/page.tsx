"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import PaymentModal from "@/components/payment/PaymentModal";
import RazorpayCheckout from "@/components/payment/RazorpayCheckout";
import ReceiptView from "@/components/ReceiptView";

const ORDER_FLOW = ["placed", "payment_confirmed", "processing", "ready_for_handover", "handed_over", "completed"];
const ORDER_LABEL: Record<string, string> = {
  placed: "Order Placed",
  payment_confirmed: "Payment Confirmed",
  processing: "Processing",
  ready_for_handover: "Ready for Handover",
  handed_over: "Handed Over",
  completed: "Completed",
  cancelled: "Cancelled",
  payment_failed: "Payment Failed",
};

export default function AccountPage() {
  const [data, setData] = useState<any>(null);
  const [payments, setPayments] = useState<any[]>([]);
  const [orders, setOrders] = useState<any[]>([]);
  const [feeHistory, setFeeHistory] = useState<any[]>([]);
  const [schedule, setSchedule] = useState<any[]>([]);
  const [feePayments, setFeePayments] = useState<any[]>([]);
  const [receipts, setReceipts] = useState<any[]>([]);
  const [openOrder, setOpenOrder] = useState<string | null>(null);
  const [showReceipt, setShowReceipt] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [paymentModal, setPaymentModal] = useState<{ open: boolean; payment: any }>({ open: false, payment: null });
  // pay-installment modal
  const [payFor, setPayFor] = useState<any>(null);
  const [payForm, setPayForm] = useState({ amount: "", method: "upi", transactionId: "", screenshot: "", note: "" });
  const [paying, setPaying] = useState(false);
  const [payMsg, setPayMsg] = useState("");
  const [rzp, setRzp] = useState<any>(null);
  const [complaints, setComplaints] = useState<any[]>([]);
  const [cForm, setCForm] = useState({ subject: "", message: "", category: "general", priority: "normal" });
  const [cBusy, setCBusy] = useState(false);
  const [cMsg, setCMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((d) => {
        if (!d.authenticated) { router.push("/login"); return; }
        if (d.mustChangePassword) { router.push("/change-password"); return; }
        setData(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));

    fetch("/api/student/payments").then((r) => r.json()).then((d) => setPayments(d)).catch(() => setPayments([]));
    fetch("/api/store/orders").then((r) => r.json()).then((d) => Array.isArray(d) && setOrders(d)).catch(() => setOrders([]));
    fetch("/api/student/admission-payments").then((r) => r.json()).then((d) => Array.isArray(d) && setFeeHistory(d)).catch(() => setFeeHistory([]));
    fetch("/api/student/schedule").then((r) => r.json()).then((d) => Array.isArray(d) && setSchedule(d)).catch(() => setSchedule([]));
    fetch("/api/student/fee-payments").then((r) => r.json()).then((d) => Array.isArray(d) && setFeePayments(d)).catch(() => setFeePayments([]));
    fetch("/api/student/receipts").then((r) => r.json()).then((d) => Array.isArray(d) && setReceipts(d)).catch(() => setReceipts([]));
    loadComplaints();
  }, [router]);

  const loadComplaints = () => {
    fetch("/api/student/complaints", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setComplaints(d))
      .catch(() => setComplaints([]));
  };

  const sendComplaint = async () => {
    setCMsg(null);
    if (!cForm.subject.trim()) return setCMsg({ type: "err", text: "Please add a subject" });
    if (cForm.message.trim().length < 10) return setCMsg({ type: "err", text: "Please describe your issue (min 10 characters)" });
    setCBusy(true);
    const r = await fetch("/api/student/complaints", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(cForm) });
    const d = await r.json().catch(() => ({}));
    setCBusy(false);
    if (r.ok) {
      setCMsg({ type: "ok", text: "Complaint sent to the admin team. You will get an email reply." });
      setCForm({ subject: "", message: "", category: "general", priority: "normal" });
      loadComplaints();
    } else setCMsg({ type: "err", text: d.error || "Failed to send" });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    try { localStorage.setItem("ayaan_auth_changed", Date.now().toString()); window.dispatchEvent(new Event("ayaan_auth_changed")); } catch {}
    router.push("/login");
  };

  const printIdCard = () => {
    if (!data) return;
    const uu = data.user;
    const aa = data.admission || {};
    const fmt = (d: any) => { try { return new Date(d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }); } catch { return "—"; } };
    const status = String(uu.digitalIdStatus || "active").toUpperCase();
    const statusColor = status === "ACTIVE" ? "#059669" : "#dc2626";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Student ID — ${uu.studentId || uu.name}</title>
    <style>
      *{box-sizing:border-box} body{font-family:Inter,system-ui,Arial,sans-serif;margin:0;padding:24px;background:#f1f5f9;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .card{width:340px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0}
      .top{background:#0f172a;color:#fff;padding:14px 16px;display:flex;gap:10px;align-items:center}
      .logo{width:38px;height:38px;border-radius:10px;background:#fff;color:#0f172a;display:grid;place-items:center;font-weight:800}
      .top h1{margin:0;font-size:14px;letter-spacing:0.06em}.top p{margin:2px 0 0;font-size:9px;letter-spacing:0.18em;opacity:0.6}
      .body{padding:16px;display:flex;gap:14px}
      .photo{width:96px;height:112px;border-radius:12px;object-fit:cover;border:1px solid #e2e8f0;background:#f8fafc}
      .nophoto{width:96px;height:112px;border-radius:12px;background:#e2e8f0;display:grid;place-items:center;font-size:28px;font-weight:800;color:#94a3b8}
      .name{font-size:17px;font-weight:800;color:#0f172a} .sub{font-size:11px;color:#64748b;margin-top:2px}
      .rows{margin-top:10px;display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:11px}
      .rows .k{color:#64748b} .rows .v{font-weight:700;color:#0f172a}
      .exp{margin:0 16px 4px;padding:8px 12px;border-radius:10px;background:#fef2f2;border:1px solid #fecaca;font-size:11px;color:#991b1b;text-align:center}
      .foot{padding:10px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:10px;color:#64748b;display:flex;justify-content:space-between}
      .badge{font-size:10px;font-weight:800;padding:3px 10px;border-radius:999px;color:${statusColor};border:1px solid currentColor}
      .sig{margin:14px auto 0;width:340px;display:flex;justify-content:space-between;font-size:10px;color:#475569}
      .sig div{border-top:1px solid #0f172a;padding-top:4px;width:45%;text-align:center}
      @media print{ body{background:#fff;padding:0} .no-print{display:none} }
    </style></head><body>
      <div class="card">
        <div class="top"><div class="logo">A</div><div style="flex:1"><h1>AYAAN INSTITUTE</h1><p>GROUP OF COMPETITIVE INSTITUTIONS</p></div><span class="badge">${status}</span></div>
        <div class="body">
          ${aa.photo ? `<img src="${aa.photo}" class="photo" alt="photo"/>` : `<div class="nophoto">${String(uu.name || "?").trim().charAt(0).toUpperCase()}</div>`}
          <div style="flex:1;min-width:0">
            <div class="name">${String(uu.name || "").replace(/</g, "&lt;")}</div>
            <div class="sub">${String(aa.course || uu.course || "").replace(/</g, "&lt;")}${aa.branch ? " • " + String(aa.branch).replace(/</g, "&lt;") : ""}</div>
            <div class="rows">
              <span class="k">Student ID</span><span class="v">${uu.studentId || "—"}</span>
              <span class="k">Digital ID</span><span class="v">${uu.digitalIdNo || "—"}</span>
              <span class="k">Phone</span><span class="v">${uu.phone || "—"}</span>
              <span class="k">Batch</span><span class="v">${String(aa.batchName || "—").replace(/</g, "&lt;")}</span>
            </div>
          </div>
        </div>
        <div class="exp">VALID TILL <b>${fmt(uu.digitalIdValidUntil)}</b> (from ${fmt(uu.digitalIdValidFrom)})</div>
        <div class="foot"><span>${uu.email || ""}</span><span>${uu.digitalIdNo || ""}</span></div>
      </div>
      <div class="sig"><div>Student Signature</div><div>Authorized Signatory</div></div>
      <div class="no-print" style="text-align:center;margin-top:16px"><button onclick="window.print()" style="padding:10px 22px;border-radius:999px;background:#0f172a;color:#fff;border:none;font-weight:700;cursor:pointer">Print / Save as PDF</button></div>
      <script>window.onload=()=>setTimeout(()=>window.print(),300);<\/script>
    </body></html>`;
    const w = window.open("", "_blank");
    if (!w) return alert("Popup blocked — allow popups to print");
    w.document.open(); w.document.write(html); w.document.close();
  };

  if (loading) return <div className="min-h-[50vh] grid place-items-center text-slate-500">Loading…</div>;
  if (!data) return null;

  const u = data.user;
  const a = data.admission;
  const pendingPayments = payments.filter((p) => p.status === "pending" || p.status === "pending_verification");
  const sched = schedule[0] || null;

  const onPayFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 3 * 1024 * 1024) return alert("Screenshot must be <3MB");
    const reader = new FileReader();
    reader.onload = () => setPayForm({ ...payForm, screenshot: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const submitFeePayment = async () => {
    if (!sched || !payFor) return;
    setPayMsg("");
    const amt = Math.round(Number(payForm.amount));
    if (!amt || amt <= 0) return setPayMsg("Enter amount > 0");
    if (amt > payFor.outstanding) return setPayMsg(`Exceeds outstanding ₹${payFor.outstanding.toLocaleString("en-IN")}`);
    if (payForm.method === "upi" && (!payForm.transactionId.trim() || !payForm.screenshot)) return setPayMsg("UPI needs transaction ID + screenshot");
    if (payForm.method === "bank" && !payForm.transactionId.trim()) return setPayMsg("Bank needs transaction ID");
    setPaying(true);
    const r = await fetch("/api/student/fee-payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        admissionId: sched.admission.id,
        installmentId: payFor.id,
        amount: amt,
        method: payForm.method,
        transactionId: payForm.transactionId.trim(),
        screenshot: payForm.screenshot,
        note: payForm.note.trim(),
      }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) { setPaying(false); return setPayMsg(d.error || "Failed"); }

    if (payForm.method === "razorpay") {
      // Get Razorpay order for this payment, then open checkout
      const ro = await fetch("/api/student/fee-payments/razorpay-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ feePaymentId: d.payment.id }),
      });
      const od = await ro.json().catch(() => ({}));
      setPaying(false);
      if (!ro.ok) return setPayMsg(od.error || "Payment init failed");
      setRzp({ feePaymentId: d.payment.id, orderId: od.razorpayOrderId, amount: d.payment.amount, name: u.name, email: u.email, phone: u.phone });
    } else {
      setPaying(false);
      setPayFor(null);
      setPayForm({ amount: "", method: "upi", transactionId: "", screenshot: "", note: "" });
      alert("Payment recorded — pending admin verification. Receipt comes after acknowledgement.");
      window.location.reload();
    }
  };

  const onRzpSuccess = async (paymentId: string, orderId: string, signature: string) => {
    if (!rzp) return;
    const r = await fetch("/api/student/fee-payments/razorpay-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feePaymentId: rzp.feePaymentId, razorpay_payment_id: paymentId, razorpay_signature: signature }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setPayMsg(d.error || "Verification failed");
    setRzp(null);
    setPayFor(null);
    alert("Payment successful — pending admin acknowledgement. Receipt comes after acknowledgement.");
    window.location.reload();
  };

  return (
    <div className="bg-slate-50 min-h-[70vh] py-8">
      <div className="container-soft">
        <div className="max-w-3xl mx-auto">
          <div className="flex items-center justify-between">
            <h1 className="font-display font-bold text-2xl text-navy-900">My Account</h1>
            <button onClick={logout} className="px-4 py-2 rounded-full border border-slate-200 bg-white text-sm hover:bg-slate-50">Logout</button>
          </div>

          <div className="card mt-6 p-6">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-navy-900 text-white grid place-items-center font-bold">{u.name[0]}</div>
              <div>
                <div className="font-semibold text-navy-900">{u.name}</div>
                {u.studentId && <div className="text-xs font-bold text-emerald-700">{u.studentId}</div>}
                <div className="text-sm text-slate-600">{u.email} • {u.phone}</div>
                <div className="text-xs text-slate-500">{u.course} • {u.medium} • {u.mode}</div>
              </div>
              <span className="ml-auto px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-xs text-emerald-700">Active</span>
            </div>
            {(u.digitalIdNo || u.studentId) && (
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <div className="text-xs font-semibold tracking-widest text-slate-500">STUDENT ID CARD</div>
                  <button onClick={() => printIdCard()} className="text-xs px-3 py-1.5 rounded-full bg-navy-900 text-white hover:bg-navy-800">🖨️ Print / Save PDF</button>
                </div>
                <div className="mt-2 rounded-2xl overflow-hidden border border-slate-200 bg-white">
                  <div className="bg-navy-900 text-white px-4 py-3 flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-white text-navy-900 grid place-items-center font-display font-bold">A</div>
                    <div className="flex-1">
                      <div className="font-display font-bold text-sm tracking-wide">AYAAN INSTITUTE</div>
                      <div className="text-[10px] tracking-[0.18em] text-white/60">GROUP OF COMPETITIVE INSTITUTIONS • ESTD 2016</div>
                    </div>
                    <span className={`text-[10px] px-2 py-1 rounded-full border ${u.digitalIdStatus === "expired" || u.digitalIdStatus === "revoked" ? "bg-red-500/20 border-red-300/40 text-red-100" : "bg-emerald-500/20 border-emerald-300/40 text-emerald-100"}`}>{(u.digitalIdStatus || "active").toUpperCase()}</span>
                  </div>
                  <div className="p-4 flex gap-4">
                    {a?.photo ? (
                      <img src={a.photo} alt="Student photo" className="w-24 h-28 rounded-xl object-cover border border-slate-200 shrink-0" />
                    ) : (
                      <div className="w-24 h-28 rounded-xl bg-slate-100 border border-slate-200 grid place-items-center text-2xl font-bold text-slate-400 shrink-0">{u.name[0]}</div>
                    )}
                    <div className="flex-1 min-w-0 text-sm">
                      <div className="font-display font-bold text-lg text-navy-900 truncate">{u.name}</div>
                      <div className="text-xs text-slate-500">{a?.course || u.course}{a?.branch ? ` • ${a.branch}` : ""}{a?.batchName ? ` • ${a.batchName}` : ""}</div>
                      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                        <span className="text-slate-500">Student ID</span><b className="text-emerald-700">{u.studentId || "—"}</b>
                        <span className="text-slate-500">Digital ID</span><b>{u.digitalIdNo || "—"}</b>
                        <span className="text-slate-500">Phone</span><span>{u.phone}</span>
                        <span className="text-slate-500">Valid Till</span><b className="text-red-700">{u.digitalIdValidUntil ? new Date(u.digitalIdValidUntil).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</b>
                      </div>
                    </div>
                  </div>
                  <div className="px-4 py-2 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 flex justify-between">
                    <span>Valid {u.digitalIdValidFrom ? new Date(u.digitalIdValidFrom).toLocaleDateString("en-IN") : "—"} → {u.digitalIdValidUntil ? new Date(u.digitalIdValidUntil).toLocaleDateString("en-IN") : "—"}</span>
                    <span>{u.email}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {sched && (
            <div className="card mt-4 p-6">
              <div className="font-semibold text-navy-900">Admission & Batch</div>
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Application ID</span><b>{sched.admission.applicationId || "—"}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Student ID</span><b className="text-emerald-700">{sched.admission.studentId || "—"}</b></div>
                <div className="flex justify-between"><span className="text-slate-500">Status</span><span className="capitalize">{sched.admission.status}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Admission Start</span><span>{sched.admission.admissionStartDate ? new Date(sched.admission.admissionStartDate).toLocaleDateString("en-IN") : "—"}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Course End</span><span>{sched.admission.courseEndDate ? new Date(sched.admission.courseEndDate).toLocaleDateString("en-IN") : "—"}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Batch</span><span className="text-right">{sched.admission.batchName || "—"}</span></div>
              </div>
              <div className="mt-3 p-3 rounded-xl bg-slate-50 border grid grid-cols-3 gap-2 text-center text-sm">
                <div><div className="text-xs text-slate-500">Final Fee</div><div className="font-bold">₹{Number(sched.admission.finalFee).toLocaleString("en-IN")}</div></div>
                <div><div className="text-xs text-slate-500">Paid</div><div className="font-bold text-emerald-700">₹{Number(sched.admission.totalPaid).toLocaleString("en-IN")}</div></div>
                <div><div className="text-xs text-slate-500">Outstanding</div><div className="font-bold text-amber-700">₹{Number(sched.admission.outstanding).toLocaleString("en-IN")}</div></div>
              </div>

              <div className="mt-4 font-semibold text-navy-900 text-sm">Payment Schedule</div>
              <div className="mt-2 grid gap-2">
                {sched.installments.map((i: any) => (
                  <div key={i.id} className="border border-slate-200 rounded-xl p-3">
                    <div className="flex justify-between items-center text-sm flex-wrap gap-2">
                      <b>{i.label}</b>
                      <span className="text-xs">₹{Number(i.originalAmount).toLocaleString("en-IN")} • Paid ₹{Number(i.paidAmount || 0).toLocaleString("en-IN")} • Due ₹{Number(i.outstanding).toLocaleString("en-IN")}</span>
                    </div>
                    <div className="mt-1 flex gap-2 items-center flex-wrap text-xs">
                      <span className={`px-2 py-0.5 rounded-full border ${i.status === "paid" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : i.status === "partial" ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-slate-100 border-slate-200"}`}>{i.status}</span>
                      <span className="px-2 py-0.5 rounded-full border">{i.dueStatus} • {new Date(i.dueDate).toLocaleDateString("en-IN")}</span>
                      {i.outstanding > 0 && <button onClick={() => { setPayFor(i); setPayForm({ amount: String(i.outstanding), method: "upi", transactionId: "", screenshot: "", note: "" }); setPayMsg(""); }} className="ml-auto px-4 py-1.5 rounded-full bg-navy-900 text-white text-xs">Pay ₹{Number(i.outstanding).toLocaleString("en-IN")}</button>}
                    </div>
                  </div>
                ))}
                {sched.installments.length === 0 && <div className="text-xs text-slate-400">No schedule yet — admin will define installments.</div>}
              </div>
            </div>
          )}

          <div className="card mt-4 p-6">
            <div className="font-semibold text-navy-900">My Payments</div>
            {feePayments.length === 0 ? (
              <div className="text-sm text-slate-500 mt-2">No payments recorded yet.</div>
            ) : (
              <div className="mt-3 grid gap-2">
                {feePayments.map((p: any) => (
                  <div key={p.id} className="text-xs p-2.5 rounded-xl border flex flex-wrap gap-x-3 gap-y-1 items-center">
                    <b>₹{Number(p.amount).toLocaleString("en-IN")}</b>
                    <span className="capitalize">{p.method}</span>
                    <span className={`px-2 py-0.5 rounded-full border ${p.status === "acknowledged" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : p.status === "rejected" || p.status === "failed" ? "bg-red-50 border-red-200 text-red-700" : "bg-amber-50 border-amber-200 text-amber-700"}`}>{p.status.replace(/_/g, " ")}</span>
                    {(p.allocations || []).length > 0 && <span className="text-slate-500">→ {(p.allocations || []).map((al: any) => `${al.installment?.label || ""} ₹${Number(al.amount).toLocaleString("en-IN")}`).join(", ")}</span>}
                    {p.receipt && <span className="font-semibold">{p.receipt.receiptNo}</span>}
                    <span className="text-slate-400 ml-auto">{new Date(p.createdAt).toLocaleString("en-IN")}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card mt-4 p-6">
            <div className="font-semibold text-navy-900">My Receipts • {receipts.length}</div>
            {receipts.length === 0 ? (
              <div className="text-sm text-slate-500 mt-2">Receipts appear here after admin acknowledges a payment.</div>
            ) : (
              <div className="mt-3 grid gap-2">
                {receipts.map((r: any) => (
                  <div key={r.id} className="flex justify-between items-center text-sm p-3 rounded-xl border">
                    <span><b>{r.receiptNo}</b> • ₹{Number(r.amount).toLocaleString("en-IN")} • {new Date(r.createdAt).toLocaleDateString("en-IN")}</span>
                    <button onClick={() => setShowReceipt(r)} className="text-xs text-sky-700 hover:underline">View / Print</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {pendingPayments.length > 0 && (
            <div className="card mt-4 p-6">
              <div className="font-semibold text-navy-900 mb-3">Pending Payments (legacy)</div>
              <div className="space-y-3">
                {pendingPayments.map((p: any) => (
                  <div key={p.id} className="border border-slate-200 rounded-xl p-4">
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-medium text-navy-900">{p.course} - {p.mode}</div>
                        <div className="text-sm text-slate-500">Admission: {p.admissionId}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-sky-600 text-lg">₹{p.amount.toLocaleString()}</div>
                      </div>
                    </div>
                    <button onClick={() => setPaymentModal({ open: true, payment: p })} className="mt-3 w-full btn-primary">Pay Now via Razorpay</button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="card mt-4 p-6">
            <div className="font-semibold text-navy-900">Admission Details</div>
            {a ? (
              <div className="mt-3 grid gap-2 text-sm">
                <div className="flex justify-between"><span className="text-slate-500">Application ID</span><span className="font-medium text-navy-900">{a.applicationId || a.id}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Course</span><span>{a.course} • {a.medium} • {a.mode}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Batch</span><span>{a.batchName || a.batchId || "Auto assigned"}</span></div>
                <div className="flex justify-between"><span className="text-slate-500">Status</span><span className="capitalize">{a.status}</span></div>
              </div>
            ) : (
              <div className="text-sm text-slate-500 mt-2">No admission linked. Contact support.</div>
            )}
          </div>

          <div className="card mt-4 p-6">
            <div className="flex items-center justify-between">
              <div className="font-semibold text-navy-900">My Orders • {orders.length}</div>
              <Link href="/store" className="text-xs text-sky-700 hover:underline">Visit Store →</Link>
            </div>
            {orders.length === 0 ? (
              <div className="text-sm text-slate-500 mt-2">No store orders yet.</div>
            ) : (
              <div className="mt-3 grid gap-3">
                {orders.map((o: any) => (
                  <div key={o.id} className="border border-slate-200 rounded-xl p-4">
                    <div className="flex justify-between items-start gap-3">
                      <div>
                        <div className="font-medium text-navy-900">Order {o.orderNo}</div>
                        <div className="text-xs text-slate-500">{new Date(o.createdAt).toLocaleString("en-IN")}</div>
                        <div className="text-sm text-slate-600 mt-1">
                          {(o.items || []).map((it: any) => `${it.name}${it.size ? ` (${it.size})` : ""} × ${it.qty}`).join(" • ")}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="font-bold text-navy-900">₹{Number(o.subtotal).toLocaleString("en-IN")}</div>
                        <div className="text-xs text-slate-500">Pay: {o.paymentStatus}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px]">
                      {ORDER_FLOW.map((s, i) => {
                        const reached = ORDER_FLOW.indexOf(o.status) >= i;
                        return (
                          <span key={s} className="flex items-center gap-1">
                            <span className={`px-2 py-0.5 rounded-full border ${reached ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200 text-slate-400"}`}>{ORDER_LABEL[s]}</span>
                            {i < ORDER_FLOW.length - 1 && <span className="text-slate-300">→</span>}
                          </span>
                        );
                      })}
                    </div>
                    <button onClick={() => setOpenOrder(openOrder === o.id ? null : o.id)} className="mt-2 text-xs text-sky-700 hover:underline">{openOrder === o.id ? "Hide history ▲" : "Order history ▼"}</button>
                    {openOrder === o.id && (
                      <div className="mt-2 grid gap-1.5">
                        {(o.events || []).map((e: any) => (
                          <div key={e.id} className="text-xs p-2 rounded-lg bg-slate-50 border border-slate-100">
                            <b>{e.action.replace(/_/g, " ")}</b> • {new Date(e.createdAt).toLocaleString("en-IN")}
                            {e.note && <div className="text-slate-600">{e.note}</div>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="card mt-4 p-6">
            <div className="font-semibold text-navy-900">Complaint Box</div>
            <p className="text-xs text-slate-500 mt-1">Message the admin team about fees, attendance, exams, hostel, staff or anything else. You will receive an email reply, and the conversation appears below.</p>

            <div className="mt-4 grid gap-3">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700">Category</label>
                  <select value={cForm.category} onChange={(e) => setCForm({ ...cForm, category: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white">
                    <option value="general">General</option><option value="fees">Fees / Payment</option><option value="attendance">Attendance</option>
                    <option value="exam">Exam / Results</option><option value="hostel">Hostel</option><option value="staff">Staff</option>
                    <option value="website">Website / Login</option><option value="other">Other</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Priority</label>
                  <select value={cForm.priority} onChange={(e) => setCForm({ ...cForm, priority: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm bg-white">
                    <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Subject *</label>
                <input value={cForm.subject} onChange={(e) => setCForm({ ...cForm, subject: e.target.value })} placeholder="Short summary, e.g. Installment receipt not received" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
              </div>
              <div>
                <label className="text-xs font-medium text-slate-700">Message *</label>
                <textarea value={cForm.message} onChange={(e) => setCForm({ ...cForm, message: e.target.value })} placeholder="Explain your issue in detail — include dates, amounts or batch name if relevant." rows={4} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" />
              </div>
              {cMsg && <div className={`px-3 py-2 rounded-xl border text-xs ${cMsg.type === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-600"}`}>{cMsg.text}</div>}
              <button onClick={sendComplaint} disabled={cBusy} className="btn-primary justify-center disabled:opacity-60">{cBusy ? "Sending…" : "Send to Admin →"}</button>
            </div>

            {complaints.length > 0 && (
              <div className="mt-6">
                <div className="text-xs font-bold tracking-widest text-slate-500 mb-2">MY COMPLAINTS ({complaints.length})</div>
                <div className="grid gap-2">
                  {complaints.map((c) => (
                    <div key={c.id} className="border border-slate-200 rounded-xl p-4 text-sm">
                      <div className="flex items-start justify-between gap-3 flex-wrap">
                        <div>
                          <b>{c.subject}</b>
                          <div className="text-xs text-slate-500 mt-0.5 capitalize">{c.category} • {new Date(c.createdAt).toLocaleString("en-IN")}</div>
                        </div>
                        <div className="flex gap-1.5">
                          {c.priority === "high" && <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-50 border border-red-200 text-red-700">High</span>}
                          <span className={`text-[11px] px-2 py-0.5 rounded-full border capitalize ${c.status === "resolved" ? "bg-emerald-50 border-emerald-200 text-emerald-700" : c.status === "in_progress" ? "bg-amber-50 border-amber-200 text-amber-700" : "bg-sky-50 border-sky-200 text-sky-700"}`}>{String(c.status).replace(/_/g, " ")}</span>
                        </div>
                      </div>
                      <p className="mt-2 text-slate-700 whitespace-pre-wrap">{c.message}</p>
                      {c.adminReply && (
                        <div className="mt-3 p-3 rounded-xl bg-sky-50 border border-sky-200">
                          <div className="text-xs font-semibold text-sky-800">Reply from Admin{c.repliedBy ? ` (${c.repliedBy})` : ""}{c.repliedAt ? ` • ${new Date(c.repliedAt).toLocaleString("en-IN")}` : ""}</div>
                          <p className="mt-1 whitespace-pre-wrap text-slate-700">{c.adminReply}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="card mt-4 p-6">
            <div className="font-semibold text-navy-900">Registration Fee History</div>
            {feeHistory.length === 0 ? (
              <div className="text-sm text-slate-500 mt-2">No fee records yet.</div>
            ) : (
              <div className="mt-3 grid gap-3">
                {feeHistory.map((f: any) => (
                  <div key={f.admission.id} className="border border-slate-200 rounded-xl p-4 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500">Total</span><b>₹{Number(f.admission.totalFee ?? 0).toLocaleString("en-IN")}</b></div>
                    <div className="flex justify-between"><span className="text-slate-500">Paid</span><b className="text-emerald-700">₹{Number(f.paid).toLocaleString("en-IN")}</b></div>
                    <div className="mt-1 grid gap-1">
                      {f.payments.map((p: any) => (
                        <div key={p.id} className="text-xs p-2 rounded-lg bg-slate-50 border flex flex-wrap gap-x-3">
                          <b className="capitalize">{p.method}</b><span>₹{Number(p.amount).toLocaleString("en-IN")}</span>
                          <span className="text-slate-400">{new Date(p.createdAt).toLocaleString("en-IN")}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 flex gap-2">
            <Link href="/courses" className="btn-primary">Browse Courses →</Link>
            <Link href="/tests" className="btn-ghost">My Tests</Link>
          </div>
        </div>
      </div>

      {/* Pay installment modal */}
      {payFor && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 p-4 grid place-items-center" onClick={() => { setPayFor(null); setRzp(null); }}>
          <div className="card w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex justify-between items-center">
              <h3 className="font-display font-bold text-lg">Pay {payFor.label}</h3>
              <button onClick={() => { setPayFor(null); setRzp(null); }} className="w-8 h-8 rounded-full bg-slate-100 grid place-items-center">✕</button>
            </div>
            <div className="text-sm text-slate-600 mt-1">Outstanding ₹{Number(payFor.outstanding).toLocaleString("en-IN")} • Due {new Date(payFor.dueDate).toLocaleDateString("en-IN")}</div>
            <div className="mt-4 grid gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-medium">Amount (₹) *</label>
                  <input type="number" min={1} max={payFor.outstanding} value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" />
                </div>
                <div>
                  <label className="text-xs font-medium">Method *</label>
                  <select value={payForm.method} onChange={(e) => setPayForm({ ...payForm, method: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm bg-white">
                    <option value="upi">UPI</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="razorpay">Razorpay</option>
                  </select>
                </div>
              </div>
              {(payForm.method === "upi" || payForm.method === "bank") && (
                <input value={payForm.transactionId} onChange={(e) => setPayForm({ ...payForm, transactionId: e.target.value })} placeholder="Transaction ID *" className="px-3 py-2.5 rounded-xl border text-sm" />
              )}
              {payForm.method === "upi" && (
                <label className="px-4 py-2.5 rounded-xl border bg-white text-sm cursor-pointer text-center">
                  <input type="file" accept="image/*" onChange={(e) => onPayFile(e.target.files?.[0])} className="hidden" />
                  {payForm.screenshot ? "✓ Screenshot ready" : "Screenshot *…"}
                </label>
              )}
              <input value={payForm.note} onChange={(e) => setPayForm({ ...payForm, note: e.target.value })} placeholder="Note (optional)" className="px-3 py-2.5 rounded-xl border text-sm" />
              {payMsg && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{payMsg}</div>}
              <button onClick={submitFeePayment} disabled={paying} className="btn-primary justify-center disabled:opacity-50">{paying ? "Submitting…" : payForm.method === "razorpay" ? "Continue to Razorpay →" : "Submit Payment →"}</button>
              <div className="text-xs text-slate-400 text-center">Cash/UPI/Bank go to admin verification. Receipt is generated after acknowledgement.</div>
            </div>
          </div>
        </div>
      )}

      {rzp && (
        <RazorpayCheckout
          orderId={rzp.orderId}
          amount={rzp.amount}
          userName={rzp.name}
          userEmail={rzp.email}
          userPhone={rzp.phone}
          course="Fee Payment"
          description="Fee installment payment"
          onSuccess={onRzpSuccess}
          onError={(e) => { setPayMsg(e); setRzp(null); }}
          onClose={() => setRzp(null)}
        />
      )}

      {showReceipt && (
        <div className="fixed inset-0 z-[70] bg-slate-900/40 p-4 grid place-items-center" onClick={() => setShowReceipt(null)}>
          <div onClick={(e) => e.stopPropagation()}>
            <ReceiptView r={{ receiptNo: showReceipt.receiptNo, amount: showReceipt.amount, createdAt: showReceipt.createdAt, feePayment: showReceipt.feePayment }} />
          </div>
        </div>
      )}

      <PaymentModal
        isOpen={paymentModal.open}
        onClose={() => setPaymentModal({ open: false, payment: null })}
        pendingPayment={paymentModal.payment}
        userName={u.name}
        userEmail={u.email}
        userPhone={u.phone}
      />
    </div>
  );
}
