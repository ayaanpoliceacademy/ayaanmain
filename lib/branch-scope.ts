import { NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// Campus (branch) scoping
//
// An admin may be restricted to one or more campuses. `Admin.branchIds` holds
// the campus names they may see AND act on. Empty array = unrestricted (all
// campuses), which is also the default for super_admin.
//
// Every read endpoint must apply `branchWhere` and every write endpoint must
// call `canActOn` — otherwise a campus admin could act on other campuses by
// guessing an id.
// ---------------------------------------------------------------------------

export type BranchScope = { branches: string[] | null };

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

export function scopeFromAuth(auth: { admin?: any } | null | undefined): BranchScope {
  const a = auth?.admin;
  if (!a) return { branches: null };
  if (a.role === "super_admin") return { branches: null };
  const raw = Array.isArray(a.branchIds) ? a.branchIds : [];
  const list = raw.map((x: unknown) => String(x ?? "").trim()).filter((x: string) => x.length > 0);
  // No campus assignment => unrestricted (keeps existing finance/admins working)
  if (list.length === 0) return { branches: null };
  return { branches: list };
}

export function isUnscoped(scope: BranchScope): boolean {
  return scope.branches === null;
}

// Prisma `where` fragment restricting a branch-bearing column to the scope
export function branchWhere(scope: BranchScope, field = "branch", mode: "in" | "equalsAny" = "in"): any {
  if (scope.branches === null) return {};
  return { [field]: { in: scope.branches } };
}

// OR-fragment that also lets legacy rows with a blank branch through only for unscoped admins
export function branchWhereWithBlank(scope: BranchScope, field = "branch"): any {
  if (scope.branches === null) return {};
  return { [field]: { in: [...scope.branches, ""] } };
}

// Merge a where fragment with an existing where object
export function withBranch<T extends Record<string, any>>(where: T, scope: BranchScope, field = "branch", allowBlank = false): T & Record<string, any> {
  const frag = allowBlank ? branchWhereWithBlank(scope, field) : branchWhere(scope, field);
  return { ...where, ...frag } as T & Record<string, any>;
}

// Resolve a caller-supplied ?branch= against the scope.
// Returns the canonical branch to filter on, or an error when out of scope.
export function resolveBranchFilter(scope: BranchScope, requested: unknown): { branch?: string; error?: string } {
  const req = String(requested ?? "").trim();
  if (scope.branches === null) return { branch: req || undefined };
  if (!req) return {};
  const match = scope.branches.find((b) => norm(b) === norm(req));
  if (!match) return { error: `Forbidden: no access to campus "${req}"` };
  return { branch: match };
}

// In-memory filter for arrays already fetched
export function keepBranch<T>(rows: T[], scope: BranchScope, get: (row: T) => unknown, allowBlank = false): T[] {
  if (scope.branches === null) return rows;
  const allow = scope.branches.map(norm);
  if (allowBlank) allow.push("");
  return rows.filter((r) => allow.includes(norm(get(r))));
}

// Write guard: may this admin act on a record belonging to `branch`?
export function canActOn(scope: BranchScope, branch: unknown): boolean {
  if (scope.branches === null) return true;
  return scope.branches.some((b) => norm(b) === norm(branch));
}

export function forbidBranch(branch: unknown): NextResponse {
  return NextResponse.json({ error: `Forbidden: no access to campus "${String(branch ?? "").trim() || "unassigned"}"` }, { status: 403 });
}

// Campuses the admin is allowed to pick when creating data
export function allowedBranches(scope: BranchScope): string[] | null {
  return scope.branches;
}

export function describeScope(scope: BranchScope): string {
  return scope.branches === null ? "All campuses" : scope.branches.join(", ");
}