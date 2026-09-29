"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { fallbackFee } from "@/lib/fees";

type Batch = { id: string; name?: string; course: string; medium: string; mode: string; branch?: string; slot?: string; days?: string; startDate: string; endDate?: string; seats: number; filled: number; availableSeats?: number };
type Duration = { id: string; name: string; months: number };
type Addon = { id: string; name: string; fee: number; courses: string[] };
type Split = { method: string; amount: string; transactionId: string; screenshot: string; shotName: string };

const STEPS = ["Personal Details", "Course & Batch", "Fee & Payment", "Review"];

export default function AdmissionPage() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState({
    name: "", fatherName: "", phone: "", email: "", address: "", reference: "", aadharCardNumber: "",
    branch: "Warangal", course: "SI", courseType: "Regular", medium: "Telugu", mode: "Residential",
    durationId: "", batchId: "", photo: "",
  });
  const [photoName, setPhotoName] = useState("");
  const [durations, setDurations] = useState<Duration[]>([]);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [addonIds, setAddonIds] = useState<string[]>([]);
  const [splits, setSplits] = useState<Split[]>([{ method: "cash", amount: "", transactionId: "", screenshot: "", shotName: "" }]);
  const [feeConfigs, setFeeConfigs] = useState<{ course: string; mode: string; duration: string; medium: string; branch: string; amount: number }[]>([]);
  const [mediumOptions, setMediumOptions] = useState<string[]>(["Telugu", "English"]);
  const [branchOptions, setBranchOptions] = useState<string[]>(["Warangal", "Hyderabad", "Hanamkonda", "Bollikunta (Residential)"]);
  const [courseOptions, setCourseOptions] = useState<string[]>(["SI", "Constable", "Groups", "SSC GD", "Defence", "Army", "UPSC"]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; id?: string; applicationId?: string; correctionToken?: string; error?: string } | null>(null);

  useEffect(() => {
    fetch("/api/fees").then((r) => r.json()).then((d) => Array.isArray(d) && setFeeConfigs(d)).catch(() => {});
    fetch("/api/durations").then((r) => r.json()).then((d) => Array.isArray(d) && setDurations(d)).catch(() => {});
    fetch("/api/mediums").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) {
        const names = d.map((m: any) => String(m.name || m)).filter(Boolean);
        if (names.length > 0) {
          setMediumOptions(names);
          setForm((f) => (names.includes(f.medium) ? f : { ...f, medium: names[0] }));
        }
      }
    }).catch(() => {});
    fetch("/api/branches").then((r) => r.json()).then((d) => {
      if (Array.isArray(d)) {
        const names = d.map((b: any) => String(b.name || b)).filter(Boolean);
        if (names.length > 0) {
          setBranchOptions(names);
          setForm((f) => (names.includes(f.branch) ? f : { ...f, branch: names[0], batchId: "" }));
        }
      }
    }).catch(() => {});
    fetch("/api/courses").then((r) => r.json()).then((d) => {
      if (Array.isArray(d) && d.length > 0) {
        // Derive short course codes from DB courses: use slug upper-cased and title in parentheses for display, keep backward-compat with existing short codes
        const opts: string[] = d.map((c: any) => {
          const slug = String(c.slug || "").trim();
          const title: string = String(c.title || "").trim();
          // Prefer short code in parentheses e.g. "Sub-Inspector (SI)" → "SI", else use slug upper
          const m = title.match(/\(([^)]+)\)/);
          if (m) return m[1].trim();
          if (slug) return slug.toUpperCase().replace(/-/g, " ");
          return title;
        }).filter(Boolean);
        // Deduplicate, keep stable order
        const uniq = Array.from(new Set(opts));
        if (uniq.length > 0) {
          setCourseOptions(uniq);
          setForm((f) => (uniq.includes(f.course) ? f : { ...f, course: uniq[0], batchId: "" }));
        }
      }
    }).catch(() => {});
  }, []);

  const selDuration = durations.find((d) => d.id === form.durationId) || null;

  useEffect(() => {
    fetch(`/api/addons?course=${encodeURIComponent(form.course)}`)
      .then((r) => r.json()).then((d) => Array.isArray(d) && setAddons(d)).catch(() => {});
    setAddonIds([]);
  }, [form.course]);

  useEffect(() => {
    if (!form.course || !selDuration || !form.branch) { setBatches([]); return; }
    fetch(`/api/batches/available?course=${encodeURIComponent(form.course)}&months=${selDuration.months}&branch=${encodeURIComponent(form.branch)}`)
      .then((r) => r.json()).then((d) => Array.isArray(d) && setBatches(d)).catch(() => {});
  }, [form.course, selDuration, form.branch]);

  const baseFee = useMemo(() => {
    // Lookup order: exact (duration+medium+branch) → peel branch → peel medium → peel duration → Base → hardcoded
    const norm = (v: any) => (v === undefined || v === null ? "" : String(v));
    const durName = selDuration?.name || "";
    const chain: [string, string, string][] = [
      [durName, form.medium, form.branch],
      [durName, form.medium, ""],
      [durName, "", ""],
      ["", "", ""],
    ];
    const seen = new Set<string>();
    for (const [d, m, b] of chain) {
      const key = `${d}|${m}|${b}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const hit = feeConfigs.find((f) => f.course === form.course && f.mode === form.mode && norm(f.duration) === d && norm(f.medium) === m && norm(f.branch) === b);
      if (hit) return hit.amount;
    }
    return fallbackFee(form.course, form.mode);
  }, [feeConfigs, form.course, form.mode, form.medium, form.branch, selDuration]);

  const addonFees = useMemo(() => addonIds.reduce((s, id) => s + (addons.find((a) => a.id === id)?.fee || 0), 0), [addonIds, addons]);
  const totalFee = baseFee + addonFees;
  const splitSum = splits.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const balanceDue = Math.max(0, totalFee - Math.min(splitSum, totalFee));
  const selBatch = batches.find((b) => b.id === form.batchId) || null;

  const onPhoto = (f: File | undefined) => {
    if (!f) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return alert("Photo must be JPG/PNG/WEBP");
    if (f.size > 2 * 1024 * 1024) return alert("Photo must be under 2MB");
    setPhotoName(f.name);
    const reader = new FileReader();
    reader.onload = () => setForm({ ...form, photo: String(reader.result) });
    reader.readAsDataURL(f);
  };

  const onSplitFile = (idx: number, file: File | undefined) => {
    if (!file) return;
    if (file.size > 3 * 1024 * 1024) return alert("Screenshot must be <3MB");
    const reader = new FileReader();
    reader.onload = () => setSplits((prev) => prev.map((s, i) => (i === idx ? { ...s, screenshot: String(reader.result), shotName: file.name } : s)));
    reader.readAsDataURL(file);
  };

  const validStep = (s: number): string | null => {
    if (s === 0) {
      if (!form.name.trim() || !form.fatherName.trim()) return "Name and Father Name required";
      if (!/^[0-9]{10}$/.test(form.phone.trim())) return "Valid 10-digit mobile required";
      if (!form.email.trim() || !form.email.includes("@")) return "Valid email required";
      if (!form.address.trim()) return "Address required";
      if (!/^[0-9]{12}$/.test(String(form.aadharCardNumber || "").trim())) return "Valid 12-digit Aadhar number required";
    }
    if (s === 1) {
      if (!form.durationId) return "Select a duration";
      if (!form.batchId) return "Select an available batch";
    }
    return null;
  };

  const submit = async () => {
    setSubmitting(true);
    setResult(null);
    const normalized = splits
      .map((s) => ({ method: s.method, amount: Math.round(Number(s.amount) || 0), transactionId: s.transactionId.trim(), screenshot: s.screenshot }))
      .filter((s) => s.amount > 0);
    for (let i = 0; i < normalized.length; i++) {
      const s = normalized[i];
      if (s.method === "upi" && (!s.transactionId || !s.screenshot)) {
        setSubmitting(false);
        setResult({ ok: false, error: `Payment ${i + 1} (UPI): Transaction ID + Screenshot required` });
        return;
      }
      if (s.method === "bank" && !s.transactionId) {
        setSubmitting(false);
        setResult({ ok: false, error: `Payment ${i + 1} (Bank): Transaction ID required` });
        return;
      }
    }
    const sum = normalized.reduce((a, x) => a + x.amount, 0);
    if (sum > totalFee) {
      setSubmitting(false);
      setResult({ ok: false, error: `Payment total exceeds fee ₹${totalFee.toLocaleString("en-IN")}` });
      return;
    }
    const primary = normalized[0];
    const r = await fetch("/api/admissions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        durationId: form.durationId || undefined,
        addonIds,
        payments: normalized,
        payingNow: sum,
        paymentMethod: primary?.method || "cash",
        transactionId: primary?.transactionId || "",
        screenshot: primary?.screenshot || "",
      }),
    });
    const data = await r.json();
    setSubmitting(false);
    if (r.ok) setResult({ ok: true, id: data.id, applicationId: data.applicationId, correctionToken: data.correctionToken });
    else setResult({ ok: false, error: data.error || "Failed" });
  };

  if (result?.ok) {
    const correctLink = result.correctionToken ? `/apply/correct?token=${result.correctionToken}` : "";
    return (
      <div className="min-h-[70vh] bg-slate-50 grid place-items-center p-4">
        <div className="card p-8 max-w-lg w-full text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center mx-auto text-xl">✓</div>
          <h1 className="mt-4 font-display font-bold text-xl text-navy-900">Registration Submitted!</h1>
          <div className="mt-3 p-3 rounded-xl bg-navy-900 text-white">
            <div className="text-xs tracking-widest text-white/60">APPLICATION ID</div>
            <div className="font-display font-bold text-lg">{result.applicationId}</div>
          </div>
          <p className="text-sm text-slate-600 mt-3">Status: <b>Pending Review</b>. No student login is created yet — access is enabled only after admin approval.</p>
          {correctLink && (
            <div className="mt-3 p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 text-left">
              If admin asks for corrections, use this private link (save it):<br />
              <Link href={correctLink} className="text-sky-700 hover:underline break-all">{correctLink}</Link>
            </div>
          )}
          <div className="mt-6 flex gap-2 justify-center">
            <Link href="/login" className="btn-primary">Go to Login →</Link>
            <Link href="/" className="btn-ghost">Home</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#fcfcfd] py-8">
      <div className="container-soft">
        <div className="max-w-3xl mx-auto">
          <div className="text-center">
            <h1 className="font-display font-bold text-3xl text-navy-900">Get Registered</h1>
            <p className="text-sm text-slate-600 mt-2">Registration creates an <b>Application</b> — student login is enabled only after admin approval.</p>
          </div>

          <div className="mt-6 flex items-center gap-1">
            {STEPS.map((s, i) => (
              <div key={s} className="flex-1 flex items-center gap-1">
                <div className="flex-1">
                  <div className={`h-1.5 rounded-full ${i <= step ? "bg-navy-900" : "bg-slate-200"}`} />
                  <div className={`mt-1 text-[11px] font-medium ${i <= step ? "text-navy-900" : "text-slate-400"}`}>{i + 1}. {s}</div>
                </div>
              </div>
            ))}
          </div>

          <div className="card mt-6 p-6 lg:p-8">
            {step === 0 && (
              <div className="grid gap-4">
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><label className="text-xs font-medium text-slate-700">Full Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g., Sai Kumar" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
                  <div><label className="text-xs font-medium text-slate-700">Father Name *</label><input value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} placeholder="e.g., Ramesh Kumar" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><label className="text-xs font-medium text-slate-700">Email * (will be username)</label><input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
                  <div><label className="text-xs font-medium text-slate-700">Mobile * (10 digits)</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="9876543210" inputMode="numeric" maxLength={10} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
                </div>
                <div><label className="text-xs font-medium text-slate-700">Address *</label><textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="H.No, Street, Village, District, State - PIN" rows={2} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div><label className="text-xs font-medium text-slate-700">Aadhar Card Number * (12 digits)</label><input value={form.aadharCardNumber} onChange={(e) => setForm({ ...form, aadharCardNumber: e.target.value.replace(/\D/g, "").slice(0,12) })} placeholder="1234 5678 9012" inputMode="numeric" maxLength={12} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm tracking-widest" /></div>
                  <div><label className="text-xs font-medium text-slate-700">Reference (optional)</label><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} placeholder="Referred by / Friend / Ad" className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm" /></div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4">
                  <div className="hidden sm:block"></div>
                  <div>
                    <label className="text-xs font-medium text-slate-700">Passport Photo (JPG/PNG/WEBP, max 2MB)</label>
                    <div className="mt-1 flex items-center gap-3">
                      {form.photo ? <img src={form.photo} alt="photo" className="w-14 h-14 rounded-xl object-cover border border-slate-200" /> : <div className="w-14 h-14 rounded-xl bg-slate-100 border border-slate-200 grid place-items-center text-xs text-slate-400">Photo</div>}
                      <label className="px-4 py-2.5 rounded-xl border border-slate-200 bg-white text-sm hover:bg-slate-50 cursor-pointer">
                        <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => onPhoto(e.target.files?.[0])} className="hidden" />
                        {photoName || "Choose photo…"}
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {step === 1 && (
              <div className="grid gap-4">
                <div className="grid sm:grid-cols-3 gap-3">
                  <div><label className="text-xs font-medium text-slate-700">Course *</label><select value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value, batchId: "" })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
                  <div><label className="text-xs font-medium text-slate-700">Duration *</label><select value={form.durationId} onChange={(e) => setForm({ ...form, durationId: e.target.value, batchId: "" })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option value="">Select duration…</option>{durations.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></div>
                  <div><label className="text-xs font-medium text-slate-700">Branch *</label><select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value, batchId: "" })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
                </div>
                <div className="grid sm:grid-cols-3 gap-3">
                  <div><label className="text-xs font-medium text-slate-700">Course Type</label><select value={form.courseType} onChange={(e) => setForm({ ...form, courseType: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Regular</option><option>Crash</option><option>Weekend</option><option>Online</option></select></div>
                  <div><label className="text-xs font-medium text-slate-700">Medium</label><select value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm">{mediumOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
                  <div><label className="text-xs font-medium text-slate-700">Mode</label><select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"><option>Residential</option><option>Offline</option><option>Online</option></select></div>
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700">Available Batches * {selDuration ? `— ${form.course}, ${selDuration.name}, ${form.branch}` : ""}</label>
                  {!selDuration ? (
                    <div className="mt-1 text-sm text-slate-500 p-3 rounded-xl bg-slate-50 border">Select course, duration & branch to see batches.</div>
                  ) : batches.length === 0 ? (
                    <div className="mt-1 text-sm text-slate-500 p-3 rounded-xl bg-amber-50 border border-amber-200">No active batches with seats for this combination right now. Try another branch or contact +91 88866 67222.</div>
                  ) : (
                    <div className="mt-2 grid gap-2">
                      {batches.map((b) => (
                        <button
                          key={b.id}
                          type="button"
                          onClick={() => setForm({ ...form, batchId: b.id })}
                          className={`p-3 rounded-xl border text-left transition ${form.batchId === b.id ? "bg-navy-900 text-white border-navy-900" : "bg-white border-slate-200 hover:bg-slate-50"}`}
                        >
                          <div className="text-sm font-semibold">{b.name || `${b.course} Batch`}</div>
                          <div className={`text-xs mt-1 ${form.batchId === b.id ? "text-white/70" : "text-slate-500"}`}>
                            {new Date(b.startDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
                            {b.endDate ? ` → ${new Date(b.endDate).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}` : ""}
                            {b.slot ? ` • ${b.slot}` : ""}{b.days ? ` • ${b.days}` : ""} • {b.availableSeats} seats left
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-xs font-medium text-slate-700">Add-ons (optional — from admin config)</label>
                  {addons.length === 0 ? (
                    <div className="mt-1 text-xs text-slate-400">No add-ons for this course.</div>
                  ) : (
                    <div className="mt-2 grid gap-2">
                      {addons.map((a) => (
                        <label key={a.id} className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer ${addonIds.includes(a.id) ? "bg-sky-50 border-sky-300" : "bg-white border-slate-200"}`}>
                          <input type="checkbox" checked={addonIds.includes(a.id)} onChange={(e) => setAddonIds(e.target.checked ? [...addonIds, a.id] : addonIds.filter((x) => x !== a.id))} />
                          <span className="text-sm font-medium flex-1">{a.name}</span>
                          <span className="text-sm font-bold text-navy-900">₹{a.fee.toLocaleString("en-IN")}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="grid gap-4">
                <div className="grid sm:grid-cols-3 gap-3">
                  <div className="p-3 rounded-xl bg-slate-50 border"><div className="text-xs text-slate-500">Base Fee</div><div className="text-lg font-bold text-navy-900">₹{baseFee.toLocaleString("en-IN")}</div><div className="text-xs text-slate-500">{form.course} • {form.mode} • {selDuration?.name || "Base"} • {form.medium} • {form.branch}</div></div>
                  <div className="p-3 rounded-xl bg-violet-50 border border-violet-200"><div className="text-xs text-violet-700">Add-ons ({addonIds.length})</div><div className="text-lg font-bold text-violet-800">+ ₹{addonFees.toLocaleString("en-IN")}</div><div className="text-xs text-violet-600">Discounts applied by admin later</div></div>
                  <div className="p-3 rounded-xl bg-sky-50 border border-sky-200"><div className="text-xs text-sky-700">Total Fee</div><div className="text-lg font-bold text-sky-700">₹{totalFee.toLocaleString("en-IN")}</div><div className="text-xs text-sky-600">Pay now (optional) or later</div></div>
                </div>

                <div>
                  <div className="text-sm font-semibold text-navy-900">Pay now (optional) — split across methods</div>
                  <div className="mt-2 grid gap-2">
                    {splits.map((s, idx) => (
                      <div key={idx} className="p-3 rounded-xl border border-slate-200 bg-slate-50/50 grid gap-2">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <select value={s.method} onChange={(e) => setSplits((prev) => prev.map((x, i) => (i === idx ? { ...x, method: e.target.value } : x)))} className="px-3 py-2.5 rounded-xl border bg-white text-sm"><option value="cash">Cash</option><option value="upi">UPI</option><option value="bank">Bank</option><option value="razorpay">Razorpay</option></select>
                          <input type="number" min={0} value={s.amount} onChange={(e) => setSplits((prev) => prev.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} placeholder="Amount ₹" className="px-3 py-2.5 rounded-xl border bg-white text-sm" />
                          {(s.method === "upi" || s.method === "bank") && <input value={s.transactionId} onChange={(e) => setSplits((prev) => prev.map((x, i) => (i === idx ? { ...x, transactionId: e.target.value } : x)))} placeholder="Txn ID *" className="px-3 py-2.5 rounded-xl border bg-white text-sm" />}
                          {s.method === "upi" ? (
                            <label className="px-3 py-2.5 rounded-xl border bg-white text-sm cursor-pointer text-center">{s.shotName || "Screenshot *"}<input type="file" accept="image/*" onChange={(e) => onSplitFile(idx, e.target.files?.[0])} className="hidden" /></label>
                          ) : splits.length > 1 ? (
                            <button type="button" onClick={() => setSplits((prev) => prev.filter((_, i) => i !== idx))} className="text-xs text-red-600 hover:underline">Remove</button>
                          ) : <span />}
                        </div>
                      </div>
                    ))}
                  </div>
                  {splits.length < 4 && <button type="button" onClick={() => setSplits((prev) => [...prev, { method: "upi", amount: "", transactionId: "", screenshot: "", shotName: "" }])} className="mt-2 px-4 py-2 rounded-full border text-xs font-medium hover:bg-slate-50">+ Add another method</button>}
                  <div className="mt-2 text-sm">Paying: <b>₹{Math.min(splitSum, totalFee).toLocaleString("en-IN")}</b> • Balance: <b>₹{balanceDue.toLocaleString("en-IN")}</b></div>
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="grid gap-3 text-sm">
                <div className="text-sm font-semibold text-navy-900">Review Registration</div>
                {[
                  ["Name", `${form.name} S/o ${form.fatherName}`],
                  ["Contact", `${form.email} • ${form.phone}`],
                  ["Aadhar", form.aadharCardNumber ? form.aadharCardNumber.replace(/(.{4})/g, "$1 ").trim() : "—"],
                  ["Address", form.address],
                  ["Course", `${form.course} • ${form.courseType} • ${form.medium} • ${form.mode}`],
                  ["Duration", selDuration ? selDuration.name : "—"],
                  ["Branch", form.branch],
                  ["Batch", selBatch ? `${selBatch.name || selBatch.course} (${selBatch.availableSeats} seats left)` : "—"],
                  ["Add-ons", addonIds.length ? addons.filter((a) => addonIds.includes(a.id)).map((a) => `${a.name} ₹${a.fee}`).join(", ") : "None"],
                  ["Fee", `Base ₹${baseFee.toLocaleString("en-IN")} + Add-ons ₹${addonFees.toLocaleString("en-IN")} = ₹${totalFee.toLocaleString("en-IN")}`],
                  ["Paying now", `₹${Math.min(splitSum, totalFee).toLocaleString("en-IN")} • Balance ₹${balanceDue.toLocaleString("en-IN")}`],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-4 p-3 rounded-xl bg-slate-50 border"><span className="text-slate-500">{k}</span><span className="font-medium text-right">{v}</span></div>
                ))}
                <div className="text-xs text-slate-500 p-3 rounded-xl bg-amber-50 border border-amber-200">Submitting creates an <b>Application</b> (Pending Review). No student login until admin approval.</div>
                {result?.error && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{result.error}</div>}
              </div>
            )}

            {result?.error && step !== 3 && <div className="text-sm text-red-700 bg-red-50 border border-red-200 px-3 py-2 rounded-xl">{result.error}</div>}

            <div className="flex gap-2 pt-2">
              {step > 0 && <button type="button" onClick={() => setStep(step - 1)} className="px-5 py-3 rounded-full border border-slate-200 text-sm font-medium hover:bg-slate-50">← Back</button>}
              {step < 3 ? (
                <button
                  type="button"
                  onClick={() => {
                    const err = validStep(step);
                    if (err) return setResult({ ok: false, error: err });
                    setResult(null);
                    setStep(step + 1);
                    window.scrollTo({ top: 0, behavior: "smooth" });
                  }}
                  className="flex-1 btn-primary justify-center !py-3"
                >Continue →</button>
              ) : (
                <button onClick={submit} disabled={submitting} className="flex-1 btn-primary justify-center !py-3 disabled:opacity-50">{submitting ? "Submitting…" : "Submit Registration →"}</button>
              )}
            </div>
            <div className="text-center text-xs text-slate-500">Already applied? <Link href="/login" className="text-sky-700 hover:underline">Login to check status</Link></div>
          </div>
        </div>
      </div>
    </div>
  );
}
