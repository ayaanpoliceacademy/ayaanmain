"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { courseDetails as fallbackDetails } from "@/data/courseDetails";
import { dummyForCourse } from "@/lib/dummyImages";
import { nk } from "@/lib/fees";

type Tab = "overview" | "prereq" | "notification" | "syllabus";
type CourseDetail = (typeof fallbackDetails)[number];

export default function CoursesPage() {
  const [activeSlug, setActiveSlug] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const [q, setQ] = useState("");
  const [courseDetails, setCourseDetails] = useState<CourseDetail[]>(fallbackDetails);
  const [feeConfigs, setFeeConfigs] = useState<{ course: string; mode: string; duration: string; medium: string; branch: string; amount: number }[]>([]);
  const [feeDurSel, setFeeDurSel] = useState<string>("");
  const [feeMedSel, setFeeMedSel] = useState<string>("");
  const [feeBrSel, setFeeBrSel] = useState<string>("");
  const [mediumOptions, setMediumOptions] = useState<string[]>(["Telugu", "English"]);
  const [branchOptions, setBranchOptions] = useState<string[]>(["Warangal", "Hyderabad", "Hanamkonda", "Bollikunta (Residential)"]);

  useEffect(() => {
    fetch("/api/courses")
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && d.length > 0 && setCourseDetails(d))
      .catch(() => {});
    fetch("/api/fees", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => Array.isArray(d) && setFeeConfigs(d))
      .catch(() => {});
    fetch("/api/mediums")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          const names = d.map((m: any) => String(m.name || m)).filter(Boolean);
          if (names.length > 0) setMediumOptions(names);
        }
      })
      .catch(() => {});
    fetch("/api/branches")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d)) {
          const names = d.map((b: any) => String(b.name || b)).filter(Boolean);
          if (names.length > 0) setBranchOptions(names);
        }
      })
      .catch(() => {});
  }, []);

  // Live fees from Admin → Fee Config (no hard-coding). Maps course slug to FeeConfig course key.
  // Lookup order per course + mode: selected duration → Base ("") → none ("Fee on request").
  const feeKeyFor = (slug: string): string | null => {
    const map: Record<string, string> = { si: "SI", constable: "Constable", groups: "Groups", "ssc-gd": "SSC GD", army: "Army", upsc: "UPSC" };
    return map[slug] || null;
  };
  const liveFeesFor = (slug: string) => {
    const key = feeKeyFor(slug);
    // Case-insensitive course match: FeeConfig may store "Army" while the slug is "army"
    const rows = key ? feeConfigs.filter((f) => nk(f.course) === nk(key)) : [];
    if (rows.length === 0) {
      // No mapped key — try matching the slug directly against FeeConfig
      const direct = feeConfigs.filter((f) => nk(f.course) === nk(slug));
      return direct.length > 0 ? direct : null;
    }
    return rows;
  };
  // Effective per-mode fees for the selected key (exact → peel branch → peel medium → peel duration → all-base)
  const norm = (v: any) => (v === undefined || v === null ? "" : String(v));
  const effectiveFeesFor = (slug: string, dur: string, med: string, br: string) => {
    const rows = liveFeesFor(slug);
    if (!rows) return null;
    const modes: string[] = [];
    for (const r of rows) if (modes.indexOf(r.mode) === -1) modes.push(r.mode);
    const chain: [string, string, string][] = [[dur, med, br], [dur, med, ""], [dur, "", ""], ["", "", ""]];
    const eff = modes
      .map((mode) => {
        let hit: any = null;
        let overridden = false;
        const seen = new Set<string>();
        for (const [d, m, b] of chain) {
          const k = `${d}|${m}|${b}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const row = rows.find((r) => nk(r.mode) === nk(mode) && norm(r.duration) === d && norm(r.medium) === m && norm(r.branch) === b);
          if (row) {
            hit = row;
            overridden = d !== "" || m !== "" || b !== "";
            break;
          }
        }
        return hit ? { mode, amount: hit.amount, overridden } : null;
      })
      .filter((x): x is { mode: string; amount: number; overridden: boolean } => x !== null);
    return eff.length > 0 ? eff : null;
  };
  const dimsFor = (slug: string, dim: "duration" | "medium" | "branch"): string[] => {
    const rows = liveFeesFor(slug);
    if (!rows) return [];
    const out: string[] = [];
    for (const r of rows) {
      const d = norm(r[dim]);
      if (d && out.indexOf(d) === -1) out.push(d);
    }
    return out;
  };

  const filtered = courseDetails.filter(
    (c) => !q || `${c.title} ${c.desc} ${c.tag}`.toLowerCase().includes(q.toLowerCase())
  );

  const activeCourse = activeSlug ? courseDetails.find((c) => c.slug === activeSlug) : null;

  const open = (slug: string) => {
    setActiveSlug(slug);
    setTab("overview");
    setFeeDurSel("");
    setFeeMedSel("");
    setFeeBrSel("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="bg-[#fcfcfd] pb-10">
      <section className="bg-navy-900 text-white relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-br from-sky-600/10 via-transparent to-amber-500/5" />
        <div className="container-soft py-10 relative">
          <h1 className="font-display font-bold text-3xl">Courses for Every Uniform</h1>
          <p className="text-white/70 mt-2 max-w-2xl">
            SI • Constable • Groups 1/2/3/4 • SSC GD • Defence • UPSC • Online. Offline • Residential • Online. Telugu & English.
          </p>
          <div className="mt-4 flex gap-2">
            <div className="relative">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search SI, Constable, UPSC…"
                className="w-[280px] pl-9 pr-3 py-2.5 rounded-full bg-white text-navy-900 text-sm placeholder:text-slate-400 focus:outline-none"
              />
              <span className="absolute left-3 top-2.5 text-slate-400">⌕</span>
            </div>
            <span className="hidden sm:inline-flex px-3 py-2 rounded-full bg-white/10 border border-white/20 text-xs">{filtered.length} courses</span>
          </div>
        </div>
      </section>

      {/* Active course detail drawer */}
      {activeCourse && (
        <section className="container-soft mt-6">
          <div className="card overflow-hidden border-sky-200 ring-1 ring-sky-100">
            <img src={(activeCourse as any).image || dummyForCourse(activeCourse.slug)} alt={activeCourse.title} className="w-full h-48 object-cover" onError={(e) => { (e.target as HTMLImageElement).src = dummyForCourse(activeCourse.slug); }} />
            <div className="bg-navy-900 text-white p-5 lg:p-6 flex items-start justify-between gap-4">
              <div>
                <div className="text-xs tracking-widest font-bold text-sky-300">{activeCourse.tag} • {activeCourse.duration}</div>
                <h2 className="font-display font-bold text-2xl mt-1">{activeCourse.title}</h2>
                <p className="text-white/70 text-sm mt-2 max-w-2xl">{activeCourse.desc}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs">
                  <span className="px-2 py-1 rounded-full bg-white/10 border border-white/20">{activeCourse.fee}</span>
                  <span className="px-2 py-1 rounded-full bg-white/10 border border-white/20">{activeCourse.eligibility}</span>
                  <span className="px-2 py-1 rounded-full bg-white/10 border border-white/20">{activeCourse.ageLimit}</span>
                </div>
              </div>
              <button onClick={() => setActiveSlug(null)} className="w-8 h-8 rounded-full bg-white/10 border border-white/20 grid place-items-center hover:bg-white/15 shrink-0">✕</button>
            </div>

            {/* tabs */}
            <div className="px-4 sm:px-6 pt-3 flex gap-2 border-b border-slate-100 overflow-auto">
              {[
                { id: "overview", label: "Overview" },
                { id: "prereq", label: "Prerequisites" },
                { id: "notification", label: "Notification Date" },
                { id: "syllabus", label: "Syllabus" },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id as Tab)}
                  className={`px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition ${tab === t.id ? "border-navy-900 text-navy-900" : "border-transparent text-slate-500 hover:text-navy-900"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="p-5 lg:p-6 bg-slate-50/50">
              {tab === "overview" && (
                <div className="grid lg:grid-cols-2 gap-6">
                  <div>
                    <div className="text-xs tracking-widest font-bold text-slate-700">HIGHLIGHTS</div>
                    <ul className="mt-2 grid gap-2">{activeCourse.highlights.map((h) => <li key={h} className="text-sm text-slate-700 flex gap-2"><span className="text-emerald-600">✓</span>{h}</li>)}</ul>
                    <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
                      <div className="p-3 rounded-xl bg-white border"><div className="text-slate-500">Duration</div><div className="font-semibold text-navy-900">{activeCourse.duration}</div></div>
                      <div className="p-3 rounded-xl bg-white border col-span-1">
                        <div className="text-slate-500">Fee — live from Fee Config</div>
                        {(() => {
                          const durs = dimsFor(activeCourse.slug, "duration");
                          const eff = effectiveFeesFor(activeCourse.slug, feeDurSel, feeMedSel, feeBrSel);
                          if (!eff) return <div className="font-semibold text-navy-900 mt-1">Fee on request — contact admissions</div>;
                          const hasOverride = feeDurSel || feeMedSel || feeBrSel;
                          return (
                            <>
                              <div className="mt-2 grid gap-1.5">
                                {durs.length > 0 && (
                                  <select
                                    value={feeDurSel}
                                    onChange={(e) => setFeeDurSel(e.target.value)}
                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  >
                                    <option value="">Base (all durations)</option>
                                    {durs.map((d) => (
                                      <option key={d} value={d}>{d}</option>
                                    ))}
                                  </select>
                                )}
                                <div className="grid grid-cols-2 gap-1.5">
                                  <select
                                    value={feeMedSel}
                                    onChange={(e) => setFeeMedSel(e.target.value)}
                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  >
                                    <option value="">Base (all mediums)</option>
                                    {mediumOptions.map((m) => (
                                      <option key={m} value={m}>{m}</option>
                                    ))}
                                  </select>
                                  <select
                                    value={feeBrSel}
                                    onChange={(e) => setFeeBrSel(e.target.value)}
                                    className="w-full px-2 py-1.5 rounded-lg border border-slate-200 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-sky-500"
                                  >
                                    <option value="">Base (all branches)</option>
                                    {branchOptions.map((b) => (
                                      <option key={b} value={b}>{b}</option>
                                    ))}
                                  </select>
                                </div>
                              </div>
                              <div className="mt-1 grid gap-1">
                                {eff.map((f) => (
                                  <div key={f.mode} className="flex justify-between gap-2">
                                    <span className="text-slate-500">{f.mode}{f.overridden && hasOverride ? " *" : ""}</span>
                                    <span className="font-semibold text-navy-900">₹{Number(f.amount).toLocaleString("en-IN")}</span>
                                  </div>
                                ))}
                              </div>
                              {hasOverride && <div className="mt-1 text-[11px] text-slate-400">* specific price for selected options</div>}
                            </>
                          );
                        })()}
                      </div>
                      <div className="p-3 rounded-xl bg-white border"><div className="text-slate-500">Mode</div><div className="font-semibold text-navy-900">{activeCourse.mode.join(" • ")}</div></div>
                      <div className="p-3 rounded-xl bg-white border"><div className="text-slate-500">Medium</div><div className="font-semibold text-navy-900">{activeCourse.medium.join(" • ")}</div></div>
                    </div>
                  </div>
                  <div className="card p-5 bg-navy-900 text-white border-navy-900">
                    <div className="font-semibold">Ready to join?</div>
                    <div className="text-sm text-white/70 mt-1">Get admission — discounts applied at check-out. Paying now vs due later.</div>
                    <div className="mt-4 flex gap-2">
                      <Link href="/admission" className="px-5 py-2.5 rounded-full bg-white text-navy-900 text-sm font-semibold">Get Registered →</Link>
                      <Link href="/contact" className="px-5 py-2.5 rounded-full bg-white/10 border border-white/20 text-white text-sm">Enquire</Link>
                    </div>
                    <div className="mt-3 text-xs text-white/50">Notification: {activeCourse.notificationDate}</div>
                  </div>
                </div>
              )}

              {tab === "prereq" && (
                <div>
                  <div className="text-xs tracking-widest font-bold text-slate-700">PREREQUISITES — Check before you apply</div>
                  <ul className="mt-3 grid gap-2">{activeCourse.prerequisites.map((p) => <li key={p} className="flex gap-3 p-3 rounded-xl bg-white border text-sm text-slate-700"><span className="w-6 h-6 rounded-full bg-amber-50 border border-amber-200 text-amber-700 grid place-items-center text-xs shrink-0">!</span>{p}</li>)}</ul>
                  <div className="mt-3 grid sm:grid-cols-2 gap-3 text-xs">
                    <div className="p-3 rounded-xl bg-white border"><span className="text-slate-500">Eligibility:</span> <b className="text-navy-900">{activeCourse.eligibility}</b></div>
                    <div className="p-3 rounded-xl bg-white border"><span className="text-slate-500">Age:</span> <b className="text-navy-900">{activeCourse.ageLimit}</b></div>
                  </div>
                </div>
              )}

              {tab === "notification" && (
                <div className="max-w-2xl">
                  <div className="p-4 rounded-xl bg-sky-50 border border-sky-200 flex gap-3">
                    <span className="w-8 h-8 rounded-full bg-sky-600 text-white grid place-items-center text-sm">📅</span>
                    <div>
                      <div className="text-xs tracking-widest font-bold text-sky-700">NOTIFICATION DATE</div>
                      <div className="font-semibold text-navy-900">{activeCourse.notificationDate}</div>
                      <div className="text-sm text-slate-600 mt-1">We update this within 24h of official release. Join leads get SMS/WhatsApp alert. Check <span className="font-semibold">TSLPRB / SSC / UPSC</span> official site for PDF.</div>
                    </div>
                  </div>
                  <div className="mt-3 p-3 rounded-xl bg-white border text-sm text-slate-600">Tip: Apply early — hostel seats fill in first 10 days. Fee locks on admission date, discount valid till notification +7 days.</div>
                </div>
              )}

              {tab === "syllabus" && (
                <div className="grid md:grid-cols-2 gap-4">
                  {activeCourse.syllabus.map((sec) => (
                    <div key={sec.subject} className="card p-4">
                      <div className="text-sm font-bold text-navy-900">{sec.subject}</div>
                      <ul className="mt-2 grid gap-1.5">{sec.topics.map((t) => <li key={t} className="text-sm text-slate-600 flex gap-2"><span className="text-sky-600">•</span>{t}</li>)}</ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      <section className="container-soft mt-6">
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
          {filtered.map((c) => (
            <div key={c.slug} className={`card overflow-hidden flex flex-col transition ${activeSlug === c.slug ? "ring-2 ring-navy-900 border-navy-900" : ""}`}>
              <img src={(c as any).image || dummyForCourse(c.slug)} alt={c.title} className="w-full h-40 object-cover" onError={(e) => { (e.target as HTMLImageElement).src = dummyForCourse(c.slug); }} />
              <div className="p-6 flex flex-col flex-1">
              <div className="text-xs tracking-widest font-semibold text-sky-700">{c.tag}</div>
              <div className="mt-1 font-display font-bold text-navy-900 text-lg leading-tight">{c.title}</div>
              <div className="mt-2 text-sm text-slate-600 flex-1">{c.desc}</div>
              <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                <span className="px-2 py-1 rounded-full bg-slate-50 border">{c.duration}</span>
                {(() => {
                  const live = liveFeesFor(c.slug);
                  if (!live) return <span className="px-2 py-1 rounded-full bg-white border">Fee on request</span>;
                  const min = Math.min(...live.map((f) => Number(f.amount)));
                  return <span className="px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold">From ₹{min.toLocaleString("en-IN")}</span>;
                })()}
              </div>
              <div className="mt-4 flex gap-2">
                <button onClick={() => open(c.slug)} className={`flex-1 py-2.5 rounded-full text-sm font-medium ${activeSlug === c.slug ? "bg-navy-900 text-white" : "bg-navy-900 text-white hover:bg-navy-800"}`}>View Details</button>
                <Link href="/admission" className="px-4 py-2.5 rounded-full border border-slate-200 text-sm font-medium hover:bg-slate-50 grid place-items-center">Enquire</Link>
              </div>
              <div className="mt-2 text-xs text-slate-500">Tap View Details → Prerequisites • Notification • Syllabus</div>
              </div>
            </div>
          ))}
        </div>

        <div className="card mt-6 p-6 grid lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <div className="font-semibold text-navy-900">How offline works</div>
            <p className="text-sm text-slate-600 mt-2">3 months syllabus coverage. Daily study hours, daily tests, weekly/monthly grand tests. Students categorized by performance; extra care for minimum scorers. Post-completion: daily model practice tests + discussion. Question papers can be solved at home.</p>
          </div>
          <div className="lg:col-span-4 rounded-xl bg-slate-50 border border-slate-200 p-4">
            <div className="text-sm font-semibold text-navy-900">Need help choosing?</div>
            <div className="text-sm text-slate-600 mt-1">Tell us your qualification & target year — we&apos;ll recommend SI vs Constable vs Groups vs UPSC.</div>
            <Link href="/contact" className="mt-3 inline-flex btn-primary !py-2.5">Get Recommendation →</Link>
          </div>
        </div>
      </section>
    </div>
  );
}
