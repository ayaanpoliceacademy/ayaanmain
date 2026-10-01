// Central fee fallback — single source of truth for all fee defaults.
// All fee calculations fall back to this map when no FeeConfig row exists.
// Chain: exact (course×mode×duration×medium×branch) → peel branch → peel medium → peel duration → base ("","","") → hardcoded fallback
//
// ALL matching is case/whitespace insensitive. Course codes come from several places
// (course slug "army", title code "Army", FeeConfig key "Army"), so an exact `===` lookup
// silently missed FeeConfig rows and fell through to a wrong hardcoded default
// (e.g. army/Offline returned 15000 instead of 20000).
export const FALLBACK_FEE: Record<string, Record<string, number>> = {
  SI: { Residential: 35000, Offline: 25000, Online: 15000 },
  Constable: { Residential: 28000, Offline: 18000, Online: 10800 },
  Groups: { Residential: 32000, Offline: 22000, Online: 13200 },
  "SSC GD": { Residential: 25000, Offline: 15000, Online: 9000 },
  Defence: { Residential: 30000, Offline: 20000, Online: 12000 },
  Army: { Residential: 30000, Offline: 20000, Online: 12000 },
  UPSC: { Residential: 75000, Offline: 45000, Online: 27000 },
};

const BASE_MAP: Record<string, number> = {
  SI: 25000,
  Constable: 18000,
  Groups: 22000,
  "SSC GD": 15000,
  Defence: 20000,
  Army: 20000,
  UPSC: 45000,
};

// Normalization key used for every comparison
export function nk(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim().toLowerCase();
}

export type FeeRow = { course: string; mode: string; duration: string; medium: string; branch: string; amount: number };

// Resolve a fee row from an already-loaded FeeConfig list using the documented chain.
// Pure + client-safe so the browser estimate always matches the server.
export function matchFeeRow<T extends FeeRow>(
  rows: T[],
  course: string,
  mode: string,
  duration?: string,
  medium?: string,
  branch?: string,
): T | null {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const c = nk(course);
  const mo = nk(mode);
  const d = nk(duration);
  const m = nk(medium);
  const b = nk(branch);
  const chain: [string, string, string][] = [
    [d, m, b],
    [d, m, ""],
    [d, "", ""],
    ["", "", ""],
  ];
  const seen = new Set<string>();
  for (const [dd, mm, bb] of chain) {
    const key = `${dd}|${mm}|${bb}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const hit = rows.find(
      (r) => nk(r.course) === c && nk(r.mode) === mo && nk(r.duration) === dd && nk(r.medium) === mm && nk(r.branch) === bb,
    );
    if (hit) return hit;
  }
  return null;
}

// Case-insensitive amount lookup against an in-memory list
export function matchFeeAmount<T extends FeeRow>(
  rows: T[],
  course: string,
  mode: string,
  duration?: string,
  medium?: string,
  branch?: string,
): number | null {
  const hit = matchFeeRow(rows, course, mode, duration, medium, branch);
  return hit ? Number(hit.amount) : null;
}

export function fallbackFee(course: string, mode: string): number {
  const c = nk(course);
  const mo = nk(mode);
  for (const [courseKey, modes] of Object.entries(FALLBACK_FEE)) {
    if (nk(courseKey) !== c) continue;
    for (const [modeKey, amount] of Object.entries(modes)) {
      if (nk(modeKey) === mo) return amount;
    }
    break;
  }
  let base = nearestCourse(c) ?? 15000;
  if (mo === nk("Residential")) base += 10000;
  if (mo === nk("Online")) base = Math.round(base * 0.6);
  return base;
}

// Course names drift ("Groups" vs "Group 1", "Army" vs "army 2"). Resolve an
// unknown name to the closest known course so a missing FeeConfig row can never
// silently fall back to the flat ₹15,000 default.
export function nearestCourse(course: string): number | null {
  const c = nk(course).replace(/[^a-z0-9]/g, "");
  if (!c) return null;
  for (const k of Object.keys(BASE_MAP)) {
    if (nk(k).replace(/[^a-z0-9]/g, "") === c) return BASE_MAP[k];
  }
  // one contains the other, or a shared leading word ("group 1" ~ "groups")
  const words = c.split(/[0-9]/)[0];
  let best: { key: string; score: number } | null = null;
  for (const k of Object.keys(BASE_MAP)) {
    const key = nk(k).replace(/[^a-z0-9]/g, "");
    let score = 0;
    if (key.includes(c) || c.includes(key)) score = 2;
    else if (words.length >= 4 && (key.startsWith(words.slice(0, 5)) || words.startsWith(key.slice(0, 5)))) score = 1;
    if (score > 0 && (!best || score > best.score)) best = { key: k, score };
  }
  return best ? BASE_MAP[best.key] : null;
}

// FeeConfig rows for a course, matched leniently (exact → case-insensitive → nearest).
export function matchCourseRows<T extends FeeRow>(rows: T[], course: string): T[] {
  const c = nk(course);
  const exact = rows.filter((r) => nk(r.course) === c);
  if (exact.length > 0) return exact;
  const base = nearestCourse(c);
  if (base !== null) {
    const hit = rows.find((r) => BASE_MAP[nk(r.course)] === base);
    if (hit) return rows.filter((r) => nk(r.course) === nk(hit.course));
  }
  return [];
}

export function fallbackList(): { course: string; mode: string; duration: string; medium: string; branch: string; amount: number }[] {
  const list: { course: string; mode: string; duration: string; medium: string; branch: string; amount: number }[] = [];
  for (const course of Object.keys(FALLBACK_FEE)) {
    for (const mode of Object.keys(FALLBACK_FEE[course])) {
      list.push({ course, mode, duration: "", medium: "", branch: "", amount: FALLBACK_FEE[course][mode] });
    }
  }
  return list;
}