"use client";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

function CorrectForm() {
  const params = useSearchParams();
  const token = params.get("token") || "";
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: "", fatherName: "", phone: "", address: "", reference: "", aadharCardNumber: "", branch: "", course: "", courseType: "", medium: "", mode: "", batchId: "" });
  const [branchOptions, setBranchOptions] = useState<string[]>(["Warangal", "Hyderabad", "Hanamkonda", "Bollikunta (Residential)"]);
  const [courseOptions, setCourseOptions] = useState<string[]>(["SI", "Constable", "Groups", "SSC GD", "Defence", "Army", "UPSC"]);
  const [mediumOptions, setMediumOptions] = useState<string[]>(["Telugu", "English"]);

  useEffect(() => {
    if (!token) { setErr("Missing correction link token."); return; }
    fetch(`/api/applications/correct?token=${encodeURIComponent(token)}`)
      .then((r) => r.json().then((d) => ({ ok: r.ok, d })))
      .then(({ ok, d }) => {
        if (!ok) setErr(d.error || "Invalid link");
        else {
          setData(d);
          setForm({ name: d.name || "", fatherName: d.fatherName || "", phone: d.phone || "", address: d.address || "", reference: d.reference || "", aadharCardNumber: d.aadharCardNumber || "", branch: d.branch || "", course: d.course || "", courseType: d.courseType || "", medium: d.medium || "", mode: d.mode || "", batchId: d.batchId || "" });
        }
      })
      .catch(() => setErr("Failed to load"));
    fetch("/api/branches").then((r) => r.json()).then((d) => Array.isArray(d) && setBranchOptions(d.map((b: any) => b.name))).catch(() => {});
    fetch("/api/courses").then((r) => r.json()).then((d) => {
      if (Array.isArray(d) && d.length > 0) {
        const opts: string[] = d.map((c: any) => {
          const title: string = String(c.title || "");
          const m = title.match(/\(([^)]+)\)/);
          if (m) return m[1].trim();
          return String(c.slug || title).trim();
        }).filter(Boolean);
        setCourseOptions(Array.from(new Set(opts)));
      }
    }).catch(() => {});
    fetch("/api/mediums").then((r) => r.json()).then((d) => Array.isArray(d) && setMediumOptions(d.map((m: any) => m.name))).catch(() => {});
  }, [token]);

  const submit = async () => {
    if (!form.name.trim() || !form.fatherName.trim()) { setErr("Name and Father Name required"); return; }
    if (!/^[0-9]{10}$/.test(form.phone.trim())) { setErr("Valid 10-digit mobile required"); return; }
    if (!/^[0-9]{12}$/.test(String(form.aadharCardNumber || "").trim())) { setErr("Valid 12-digit Aadhar required"); return; }
    if (!form.address.trim()) { setErr("Address required"); return; }
    setSaving(true);
    setErr("");
    const r = await fetch("/api/applications/correct", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, ...form }) });
    const d = await r.json().catch(() => ({}));
    setSaving(false);
    if (r.ok) setOk(true);
    else setErr(d.error || "Failed");
  };

  if (ok) {
    return (
      <div className="min-h-[70vh] bg-slate-50 grid place-items-center p-4">
        <div className="card p-8 max-w-md w-full text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-100 text-emerald-700 grid place-items-center mx-auto text-xl">✓</div>
          <h1 className="mt-4 font-display font-bold text-xl text-navy-900">Corrections Submitted!</h1>
          <p className="text-sm text-slate-600 mt-2">Application <b>{data?.applicationId}</b> is back <b>Pending Review</b>.</p>
          <Link href="/" className="mt-6 inline-flex btn-ghost">Home</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-[#fcfcfd] py-8">
      <div className="container-soft max-w-2xl mx-auto">
        <h1 className="font-display font-bold text-2xl text-navy-900 text-center">Correct Application</h1>
        {err ? (
          <div className="card mt-6 p-6 text-center text-sm text-red-700">{err}</div>
        ) : !data ? (
          <div className="text-center text-sm text-slate-500 mt-8">Loading…</div>
        ) : (
          <div className="card mt-6 p-6 grid gap-3">
            <div className="text-xs px-3 py-2 rounded-xl bg-amber-50 border border-amber-200 text-amber-800">Admin note: <b>{data.clarificationNote}</b></div>
            <div className="text-xs text-slate-500">Application {data.applicationId} • {data.email} (email can't be changed here)</div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="text-xs font-medium">Full Name *</label><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
              <div><label className="text-xs font-medium">Father Name *</label><input value={form.fatherName} onChange={(e) => setForm({ ...form, fatherName: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
            </div>
            <div><label className="text-xs font-medium">Mobile * (10 digits)</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
            <div><label className="text-xs font-medium">Address *</label><textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} rows={2} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
            <div><label className="text-xs font-medium">Aadhar * (12 digits)</label><input value={form.aadharCardNumber} onChange={(e) => setForm({ ...form, aadharCardNumber: e.target.value.replace(/\D/g, "").slice(0,12) })} placeholder="123456789012" inputMode="numeric" maxLength={12} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm tracking-widest" /></div>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label className="text-xs font-medium">Reference</label><input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm" /></div>
              <div><label className="text-xs font-medium">Branch</label><select value={form.branch} onChange={(e) => setForm({ ...form, branch: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm">{branchOptions.map((b) => <option key={b} value={b}>{b}</option>)}</select></div>
            </div>
            <div className="grid sm:grid-cols-3 gap-3">
              <div><label className="text-xs font-medium">Course</label><select value={form.course} onChange={(e) => setForm({ ...form, course: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm">{courseOptions.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
              <div><label className="text-xs font-medium">Medium</label><select value={form.medium} onChange={(e) => setForm({ ...form, medium: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm">{mediumOptions.map((m) => <option key={m} value={m}>{m}</option>)}</select></div>
              <div><label className="text-xs font-medium">Mode</label><select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })} className="mt-1 w-full px-3 py-2.5 rounded-xl border text-sm"><option>Residential</option><option>Offline</option><option>Online</option></select></div>
            </div>
            <button onClick={submit} disabled={saving} className="btn-primary justify-center disabled:opacity-50">{saving ? "Submitting…" : "Resubmit for Review →"}</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function CorrectPage() {
  return (
    <Suspense fallback={<div className="min-h-[50vh] grid place-items-center text-sm text-slate-500">Loading…</div>}>
      <CorrectForm />
    </Suspense>
  );
}
