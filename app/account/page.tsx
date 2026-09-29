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
  }, [router]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    try { localStorage.setItem("ayaan_auth_changed", Date.now().toString()); window.dispatchEvent(new Event("ayaan_auth_changed")); } catch {}
    router.push("/login");
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
            {u.digitalIdNo && (
              <div className="mt-4 p-4 rounded-2xl bg-navy-900 text-white flex items-center gap-4">
                <div className="w-11 h-11 rounded-xl bg-white/10 border border-white/20 grid place-items-center font-bold">ID</div>
                <div className="flex-1">
                  <div className="text-xs tracking-widest text-white/60">DIGITAL STUDENT ID • {u.digitalIdStatus || "active"}</div>
                  <div className="font-display font-bold">{u.digitalIdNo}</div>
                  <div className="text-xs text-white/60">Valid {u.digitalIdValidFrom ? new Date(u.digitalIdValidFrom).toLocaleDateString("en-IN") : "—"} → {u.digitalIdValidUntil ? new Date(u.digitalIdValidUntil).toLocaleDateString("en-IN") : "—"}</div>
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
