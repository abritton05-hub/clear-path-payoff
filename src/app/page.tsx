"use client";

import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

/**
 * Clear Path Payoff — single-file build (Next.js App Router)
 * Paste into: src/app/page.tsx
 *
 * Prototype storage:
 * - Guest: nothing saves
 * - Signed in: localStorage (users + accounts + settings)
 * - Optional: Supabase password reset email if configured (otherwise local reset)
 */

// ===== Config =====
const APP_NAME = "Clear Path Payoff";
const TAGLINE = "Discipline scoreboard — simple now, smarter every version.";
const MASTER_EMAIL = "abritton05@gmail.com";

// Promo (never display the actual code in UI)
const PROMO_CODE_PRO = "Family83";

// Storage keys
const KEY_USERS = "cpp_users_v5";
const KEY_SESSION = "cpp_session_v5";
const KEY_ACCOUNTS_PREFIX = "cpp_accounts_v5_"; // + email
const KEY_SETTINGS_PREFIX = "cpp_settings_v5_"; // + email

type Plan = "guest" | "basic" | "pro";
type Session = { email: string; plan: Exclude<Plan, "guest"> };

type UserRec = {
  email: string;
  createdAt: number;
  plan: Exclude<Plan, "guest">;
  passwordSalt: string;
  passwordHash: string;
  displayName?: string;
};

type AccountType = "Credit Card" | "Loan" | "Line of Credit" | "Other";

type Account = {
  id: string;
  name: string;
  type: AccountType;
  balance: number;
  limit: number; // user asked: include for both so % makes sense
  apr: number; // %
  minPay: number; // Next min payment
  dueDate: number; // 1-31
  notes?: string;
  createdAt: number;
};

type Settings = {
  payoffStyle: "avalanche" | "snowball";
  extraMonthly: number; // rolls forward (stored)
  lastUpdatedAt: number;
};

type AllocationRow = {
  accountId: string;
  name: string;
  min: number;
  extra: number;
  total: number;
};

type MonthPlan = {
  monthIndex: number; // 1-based
  allocations: AllocationRow[];
  totalMin: number;
  totalExtra: number;
  totalPaid: number;
  totalInterest: number;
  remainingDebt: number;
};

type SimResult = {
  monthsToPayoff: number;
  totalInterest: number;
  firstTargetIds: string[]; // ranked order at start
  monthPlans: MonthPlan[]; // can be partial (e.g., next 6)
  stalled: boolean;
};

// ===== Helpers =====
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const money = (n: number) =>
  Number.isFinite(n)
    ? n.toLocaleString(undefined, { style: "currency", currency: "USD" })
    : "$0.00";

function normalizeEmail(v: string) {
  return v.trim().toLowerCase();
}
function isMaster(email: string) {
  return normalizeEmail(email) === normalizeEmail(MASTER_EMAIL);
}
function computePlanFromEmail(email: string, stored?: Exclude<Plan, "guest">): Exclude<Plan, "guest"> {
  return isMaster(email) ? "pro" : stored ?? "basic";
}
function uid() {
  return `${Math.random().toString(16).slice(2)}-${Date.now().toString(16)}`;
}
function safeParse<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}
function lsGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  return safeParse<T>(window.localStorage.getItem(key));
}
function lsSet(key: string, value: any) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
}
function lsDel(key: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(key);
}

function ordinal(n: number) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return `${n}th`;
  const last = n % 10;
  if (last === 1) return `${n}st`;
  if (last === 2) return `${n}nd`;
  if (last === 3) return `${n}rd`;
  return `${n}th`;
}

function monthlyRate(aprPct: number) {
  return (Math.max(0, aprPct) / 100) / 12;
}

function sum(nums: number[]) {
  return nums.reduce((a, b) => a + b, 0);
}

// ===== Crypto (salted SHA-256) =====
function toHex(buf: ArrayBuffer) {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
function randomSalt(bytes = 16) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function sha256(text: string) {
  const enc = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", enc);
  return toHex(hash);
}
async function hashPassword(password: string, salt: string) {
  return sha256(`${salt}:${password}`);
}
function isStrongEnough(pw: string) {
  return pw.length >= 8;
}

// ===== Parsing (no forced leading zeros, allows '.') =====
function keepNumericChars(s: string, allowDot: boolean) {
  let out = "";
  let dotSeen = false;
  for (const ch of s) {
    if (ch >= "0" && ch <= "9") out += ch;
    else if (allowDot && ch === "." && !dotSeen) {
      out += ch;
      dotSeen = true;
    }
  }
  return out;
}
function parseMoneyLike(s: string) {
  const cleaned = keepNumericChars(s, true);
  if (cleaned === "" || cleaned === ".") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function parsePercentLike(s: string) {
  const cleaned = keepNumericChars(s, true);
  if (cleaned === "" || cleaned === ".") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}
function parseIntLike(s: string) {
  const cleaned = keepNumericChars(s, false);
  if (cleaned === "") return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}
function fmtMoneyInput(n: number) {
  // show plain typing-friendly numeric string (no commas)
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) < 0.000001) return "";
  // keep up to 2 decimals but trim trailing zeros
  const s = n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return s;
}
function fmtPercentInput(n: number) {
  if (!Number.isFinite(n)) return "";
  if (Math.abs(n) < 0.000001) return "";
  const s = n.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  return s;
}

// ===== Simulation (min everywhere, extra rolls into next target same month) =====
function rankAccounts(accts: Account[], style: "avalanche" | "snowball") {
  const alive = accts.filter((a) => a.balance > 0.00001);
  const sorted = [...alive].sort((a, b) => {
    if (style === "avalanche") {
      // highest APR first, tie-breaker higher balance
      if (b.apr !== a.apr) return b.apr - a.apr;
      return b.balance - a.balance;
    }
    // snowball: smallest balance first, tie-breaker higher APR
    if (a.balance !== b.balance) return a.balance - b.balance;
    return b.apr - a.apr;
  });
  return sorted.map((a) => a.id);
}

function simulatePayoff(
  accountsInput: Account[],
  style: "avalanche" | "snowball",
  extraMonthly: number,
  options?: { monthsCap?: number; wantMonths?: number }
): SimResult {
  const monthsCap = options?.monthsCap ?? 600;
  const wantMonths = options?.wantMonths ?? 600;

  // Clone working state (balance only changes)
  const st = accountsInput
    .map((a) => ({
      ...a,
      balance: Math.max(0, a.balance),
      limit: Math.max(0, a.limit),
      apr: Math.max(0, a.apr),
      minPay: Math.max(0, a.minPay),
      dueDate: clamp(a.dueDate || 1, 1, 31),
    }))
    .filter((a) => a.balance > 0.00001 || a.minPay > 0);

  const initialOrder = rankAccounts(st, style);
  let totalInterest = 0;
  let monthsToPayoff = 0;

  const monthPlans: MonthPlan[] = [];

  const totalDebtNow = () => sum(st.map((a) => a.balance));
  const allPaid = () => totalDebtNow() <= 0.01;

  // Stall detection: if any month we can’t reduce principal because minimums are <= interest and extra is 0
  // (This is rare given user can set minimums properly.)
  let stalled = false;

  for (let m = 1; m <= monthsCap; m++) {
    if (allPaid()) {
      monthsToPayoff = m - 1;
      break;
    }

    // 1) Accrue interest
    const interestById: Record<string, number> = {};
    for (const a of st) {
      if (a.balance <= 0.01) {
        interestById[a.id] = 0;
        continue;
      }
      const interest = a.balance * monthlyRate(a.apr);
      interestById[a.id] = interest;
      a.balance += interest;
      totalInterest += interest;
    }

    // 2) Pay minimums on all active balances
    const allocations: AllocationRow[] = [];
    let totalMin = 0;
    let totalExtra = 0;

    for (const a of st) {
      if (a.balance <= 0.01) {
        allocations.push({ accountId: a.id, name: a.name || "Account", min: 0, extra: 0, total: 0 });
        continue;
      }
      const minPay = clamp(a.minPay, 0, a.balance);
      a.balance -= minPay;
      totalMin += minPay;
      allocations.push({ accountId: a.id, name: a.name || "Account", min: minPay, extra: 0, total: minPay });
    }

    // 3) Allocate extra in priority order; roll leftover into next target in SAME month
    let extraLeft = Math.max(0, extraMonthly);
    const order = rankAccounts(st, style);

    // If extra exists but all debts are gone after mins, it stays unused
    for (const id of order) {
      if (extraLeft <= 0.00001) break;
      const a = st.find((x) => x.id === id);
      if (!a) continue;
      if (a.balance <= 0.01) continue;
      const pay = clamp(extraLeft, 0, a.balance);
      a.balance -= pay;
      extraLeft -= pay;
      totalExtra += pay;

      const row = allocations.find((r) => r.accountId === id);
      if (row) {
        row.extra += pay;
        row.total += pay;
      }
    }

    // 4) Determine if we’re stalled (no progress possible)
    // If everyone still has balance, and extraMonthly is 0, and every min is tiny, user must fix mins.
    if (m === 1) {
      const hadDebt = accountsInput.some((a) => a.balance > 0.01);
      const hasProgress = totalMin + totalExtra > 0.00001;
      if (hadDebt && !hasProgress) stalled = true;
    }

    // 5) Add month plan (only store up to wantMonths)
    if (monthPlans.length < wantMonths) {
      monthPlans.push({
        monthIndex: m,
        allocations: allocations
          .filter((r) => (r.min + r.extra) > 0.00001)
          .sort((a, b) => (b.total - a.total)),
        totalMin,
        totalExtra,
        totalPaid: totalMin + totalExtra,
        totalInterest: sum(Object.values(interestById)),
        remainingDebt: totalDebtNow(),
      });
    }

    if (allPaid()) {
      monthsToPayoff = m;
      break;
    }

    if (m === monthsCap) monthsToPayoff = monthsCap;
  }

  // If we never paid off within cap, mark stalled-ish
  if (!allPaid() && monthsToPayoff === monthsCap) stalled = true;

  return {
    monthsToPayoff,
    totalInterest,
    firstTargetIds: initialOrder,
    monthPlans,
    stalled,
  };
}

// ===== Charts =====
function UsageColor(pct: number) {
  if (pct >= 60) return "#d45b5b"; // red
  if (pct >= 31) return "#d8b24c"; // yellow
  return "#4a8b57"; // green
}

function PieChart({
  title,
  labels,
  values,
}: {
  title: string;
  labels: string[];
  values: number[];
}) {
  const total = sum(values.map((v) => Math.max(0, v)));
  const r = 42;
  const c = 2 * Math.PI * r;

  let acc = 0;
  const slices = values.map((v, i) => {
    const frac = total > 0 ? Math.max(0, v) / total : 0;
    const dash = frac * c;
    const offset = acc * c;
    acc += frac;
    return { i, dash, offset, frac };
  });

  const palette = [
    "rgba(70,160,70,0.85)",
    "rgba(90,140,220,0.85)",
    "rgba(220,140,90,0.85)",
    "rgba(170,90,200,0.80)",
    "rgba(80,180,180,0.85)",
    "rgba(210,210,90,0.85)",
  ];

  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 950 }}>{title}</div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <svg width="110" height="110" viewBox="0 0 110 110" aria-label={title}>
          <g transform="translate(55,55) rotate(-90)">
            <circle r={r} fill="none" stroke="rgba(0,0,0,0.10)" strokeWidth="12" />
            {slices.map((s) => (
              <circle
                key={s.i}
                r={r}
                fill="none"
                stroke={palette[s.i % palette.length]}
                strokeWidth="12"
                strokeLinecap="round"
                strokeDasharray={`${s.dash} ${c - s.dash}`}
                strokeDashoffset={-s.offset}
              />
            ))}
          </g>
        </svg>

        <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
          {labels.length === 0 ? (
            <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.75 }}>Add accounts to see the chart.</div>
          ) : (
            labels.map((lab, i) => (
              <div key={lab} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.8, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {lab}
                </div>
                <div style={{ fontSize: 12, fontWeight: 950 }}>{money(values[i] ?? 0)}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function UsageBars({
  rows,
}: {
  rows: { name: string; pct: number; balance: number; limit: number }[];
}) {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div style={{ fontWeight: 950 }}>Usage % (balance / limit)</div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.75 }}>Add limits to see usage bars.</div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {rows.map((r) => {
            const pct = clamp(r.pct, 0, 100);
            const filled = Math.round(pct / 10); // 0..10 segments
            const color = UsageColor(pct);
            return (
              <div key={r.name} style={{ display: "grid", gap: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <div style={{ fontWeight: 950, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.name}</div>
                  <div style={{ fontWeight: 950, opacity: 0.85 }}>
                    {Math.round(pct)}% ({money(r.balance)} / {money(r.limit)})
                  </div>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 6 }}>
                  {Array.from({ length: 10 }).map((_, i) => {
                    const on = i < filled;
                    return (
                      <div
                        key={i}
                        style={{
                          height: 14,
                          borderRadius: 999,
                          border: "1px solid rgba(0,0,0,0.12)",
                          background: on ? color : "rgba(255,255,255,0.60)",
                          boxShadow: on ? "0 6px 16px rgba(0,0,0,0.08)" : "none",
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ===== UI =====
function Card({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        borderRadius: 18,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "rgba(255,255,255,0.68)",
        backdropFilter: "blur(8px)",
        boxShadow: "0 10px 30px rgba(0,0,0,0.10)",
        padding: 16,
      }}
    >
      {children}
    </div>
  );
}

function Button({
  children,
  onClick,
  disabled,
  variant = "primary",
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "primary" | "ghost" | "danger";
  title?: string;
}) {
  const base: React.CSSProperties = {
    padding: "10px 14px",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.12)",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.55 : 1,
    fontWeight: 900,
    fontSize: 14,
    userSelect: "none",
    transition: "transform 120ms ease, box-shadow 120ms ease",
    whiteSpace: "nowrap",
  };

  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "linear-gradient(135deg, #ffffff 0%, #f7ffd9 100%)",
      boxShadow: "0 8px 18px rgba(0,0,0,0.10)",
    },
    ghost: { background: "rgba(255,255,255,0.55)" },
    danger: {
      background: "linear-gradient(135deg, #ffffff 0%, #ffd9d9 100%)",
      boxShadow: "0 8px 18px rgba(0,0,0,0.10)",
    },
  };

  return (
    <button
      title={title}
      disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{ ...base, ...styles[variant] }}
      onMouseDown={(e) => {
        if (disabled) return;
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(0.99)";
      }}
      onMouseUp={(e) => {
        (e.currentTarget as HTMLButtonElement).style.transform = "scale(1)";
      }}
    >
      {children}
    </button>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-block",
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        border: "1px solid rgba(0,0,0,0.12)",
        background: "rgba(255,255,255,0.60)",
        backdropFilter: "blur(6px)",
        fontWeight: 900,
      }}
    >
      {children}
    </span>
  );
}

function TextField({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  onBlur,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  onBlur?: () => void;
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>{label}</div>
      <input
        value={value}
        placeholder={placeholder}
        inputMode={inputMode}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        style={{
          padding: "11px 12px",
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.16)",
          background: "rgba(255,255,255,0.78)",
          outline: "none",
          fontSize: 14,
        }}
      />
    </label>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>{label}</div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          padding: "11px 12px",
          borderRadius: 12,
          border: "1px solid rgba(0,0,0,0.16)",
          background: "rgba(255,255,255,0.78)",
          outline: "none",
          fontSize: 14,
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

// ===== Page =====
export default function Page() {
  const [hydrated, setHydrated] = useState(false);

  // optional supabase status (informational)
  const [supabaseConnected, setSupabaseConnected] = useState(false);

  // auth
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "create">("signin");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [selectedPlan, setSelectedPlan] = useState<Exclude<Plan, "guest">>("basic");
  const [promoCode, setPromoCode] = useState("");
  const [statusMsg, setStatusMsg] = useState("");

  // app
  const [tab, setTab] = useState<"dashboard" | "accounts" | "plan" | "profile">("dashboard");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings>({
    payoffStyle: "avalanche",
    extraMonthly: 0,
    lastUpdatedAt: Date.now(),
  });

  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [expanded6, setExpanded6] = useState(false);

  // Draft inputs per-account (fixes dot typing + no leading zeros/spinners)
  const [draft, setDraft] = useState<Record<string, Record<string, string>>>({});

  const plan: Plan = session?.plan ?? "guest";
  const emailNorm = session?.email ? normalizeEmail(session.email) : "";
  const accountsKey = emailNorm ? `${KEY_ACCOUNTS_PREFIX}${emailNorm}` : "";
  const settingsKey = emailNorm ? `${KEY_SETTINGS_PREFIX}${emailNorm}` : "";

  const users = hydrated ? (lsGet<UserRec[]>(KEY_USERS) ?? []) : [];
  const currentUser = useMemo(() => {
    if (!emailNorm) return null;
    return users.find((u) => normalizeEmail(u.email) === emailNorm) ?? null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, emailNorm]);

  const displayName = (currentUser?.displayName?.trim() || emailNorm || "Guest").toLowerCase();

  const pageStyle: React.CSSProperties = {
    minHeight: "100vh",
    background:
      "radial-gradient(1100px 700px at 15% 10%, rgba(255,255,255,0.75), rgba(255,255,255,0) 60%)," +
      "radial-gradient(900px 600px at 85% 15%, rgba(255,205,205,0.35), rgba(255,255,255,0) 60%)," +
      "radial-gradient(900px 600px at 25% 80%, rgba(198,255,221,0.35), rgba(255,255,255,0) 55%)," +
      "radial-gradient(900px 600px at 85% 80%, rgba(198,210,255,0.35), rgba(255,255,255,0) 55%)," +
      "linear-gradient(180deg, #c8d2b8 0%, #dde6cf 40%, #eef3e6 100%)",
    color: "#1b1b1b",
  };

  function saveAccounts(next: Account[]) {
    setAccounts(next);
    if (plan === "guest") return;
    lsSet(accountsKey, next);
  }

  function saveSettings(next: Settings) {
    const s = { ...next, lastUpdatedAt: Date.now() };
    setSettings(s);
    if (plan === "guest") return;
    lsSet(settingsKey, s);
  }

  function upsertDraft(id: string, key: string, value: string) {
    setDraft((prev) => ({
      ...prev,
      [id]: { ...(prev[id] ?? {}), [key]: value },
    }));
  }

  function getDraft(id: string, key: string, fallback: string) {
    return draft[id]?.[key] ?? fallback;
  }

  function clearDraft(id: string, key: string) {
    setDraft((prev) => {
      const next = { ...prev };
      if (!next[id]) return prev;
      const row = { ...next[id] };
      delete row[key];
      next[id] = row;
      return next;
    });
  }

  // ===== auth operations =====
  async function createUser() {
    setStatusMsg("");
    const email = normalizeEmail(authEmail);
    const pw = authPassword;

    if (!email.includes("@")) return setStatusMsg("Enter a valid email.");
    if (!isStrongEnough(pw)) return setStatusMsg("Password must be at least 8 characters.");

    const usersNow = lsGet<UserRec[]>(KEY_USERS) ?? [];
    if (usersNow.some((u) => normalizeEmail(u.email) === email)) {
      setStatusMsg("Account already exists. Switch to Sign in.");
      return;
    }

    const salt = randomSalt(16);
    const hash = await hashPassword(pw, salt);

    const promoValid = promoCode.trim() !== "" && promoCode.trim() === PROMO_CODE_PRO;
    const basePlan: Exclude<Plan, "guest"> = selectedPlan === "pro" ? "basic" : selectedPlan; // pro not selectable directly
    const finalPlan = computePlanFromEmail(email, promoValid ? "pro" : basePlan);

    const rec: UserRec = {
      email,
      createdAt: Date.now(),
      plan: finalPlan,
      passwordSalt: salt,
      passwordHash: hash,
      displayName: undefined,
    };

    usersNow.push(rec);
    lsSet(KEY_USERS, usersNow);

    const s: Session = { email, plan: finalPlan };
    lsSet(KEY_SESSION, s);
    setSession(s);

    // init settings if missing
    const existingSettings = lsGet<Settings>(`${KEY_SETTINGS_PREFIX}${email}`);
    if (!existingSettings) {
      lsSet(`${KEY_SETTINGS_PREFIX}${email}`, {
        payoffStyle: "avalanche",
        extraMonthly: 0,
        lastUpdatedAt: Date.now(),
      } satisfies Settings);
    }

    setTab("dashboard");
    setStatusMsg("Signed in.");
  }

  async function signInUser() {
    setStatusMsg("");
    const email = normalizeEmail(authEmail);
    const pw = authPassword;

    if (!email.includes("@")) return setStatusMsg("Enter a valid email.");
    if (pw.length === 0) return setStatusMsg("Enter your password.");

    const usersNow = lsGet<UserRec[]>(KEY_USERS) ?? [];
    const u = usersNow.find((x) => normalizeEmail(x.email) === email);
    if (!u) return setStatusMsg("No account found. Switch to Create account.");

    const hash = await hashPassword(pw, u.passwordSalt);
    if (hash !== u.passwordHash) return setStatusMsg("Wrong password.");

    // allow promo on sign-in (guest typed it) to upgrade
    const promoValid = promoCode.trim() !== "" && promoCode.trim() === PROMO_CODE_PRO;
    let nextPlan = computePlanFromEmail(email, u.plan);

    if (promoValid && !isMaster(email) && nextPlan !== "pro") {
      // upgrade
      u.plan = "pro";
      nextPlan = "pro";
      lsSet(KEY_USERS, usersNow);
    }

    const s: Session = { email, plan: nextPlan };
    lsSet(KEY_SESSION, s);
    setSession(s);
    setTab("dashboard");
    setStatusMsg("Signed in.");
  }

  function signOut() {
    lsDel(KEY_SESSION);
    setSession(null);
    setSelectedAccountId(null);
    setExpanded6(false);
    setStatusMsg("Signed out.");
  }

  async function forgotPassword() {
    setStatusMsg("");
    const email = normalizeEmail(authEmail);
    if (!email.includes("@")) return setStatusMsg("Type your email first.");

    // Try Supabase reset if configured
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/`,
      });
      if (!error) {
        setStatusMsg("Reset email sent (if Supabase is configured). Check your inbox.");
        return;
      }
    } catch {
      // ignore
    }

    // Local reset fallback (deletes local data)
    const usersNow = lsGet<UserRec[]>(KEY_USERS) ?? [];
    const filtered = usersNow.filter((u) => normalizeEmail(u.email) !== email);
    lsSet(KEY_USERS, filtered);
    lsDel(`${KEY_ACCOUNTS_PREFIX}${email}`);
    lsDel(`${KEY_SETTINGS_PREFIX}${email}`);
    lsDel(KEY_SESSION);
    setSession(null);
    setStatusMsg("Local reset complete. Create the account again.");
  }

  // ===== init / hydration =====
  useEffect(() => {
    setHydrated(true);

    const s = lsGet<Session>(KEY_SESSION);
    if (s?.email) {
      const fixed: Session = {
        email: normalizeEmail(s.email),
        plan: computePlanFromEmail(s.email, s.plan),
      };
      setSession(fixed);
    }

    // supabase informational check
    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) return setSupabaseConnected(false);
        setSupabaseConnected(!!data?.session);
      } catch {
        setSupabaseConnected(false);
      }
    })();
  }, []);

  // load per-user data
  useEffect(() => {
    if (!hydrated) return;

    if (!emailNorm) {
      setAccounts([]);
      setSettings({ payoffStyle: "avalanche", extraMonthly: 0, lastUpdatedAt: Date.now() });
      return;
    }

    const a = lsGet<Account[]>(accountsKey);
    setAccounts(Array.isArray(a) ? a : []);

    const st = lsGet<Settings>(settingsKey);
    if (st) setSettings(st);
  }, [hydrated, emailNorm]); // eslint-disable-line react-hooks/exhaustive-deps

  // ===== derived numbers =====
  const totals = useMemo(() => {
    const totalDebt = sum(accounts.map((a) => Math.max(0, a.balance)));
    const totalMin = sum(accounts.map((a) => Math.max(0, a.minPay)));
    const interestThisMonth = sum(accounts.map((a) => Math.max(0, a.balance) * monthlyRate(a.apr)));
    return { totalDebt, totalMin, interestThisMonth };
  }, [accounts]);

  const usageRows = useMemo(() => {
    const rows = accounts
      .filter((a) => a.limit > 0.01)
      .map((a) => {
        const pct = (a.balance / a.limit) * 100;
        return {
          name: a.name?.trim() || "Account",
          pct: Number.isFinite(pct) ? pct : 0,
          balance: a.balance,
          limit: a.limit,
        };
      })
      .sort((a, b) => b.pct - a.pct);
    return rows;
  }, [accounts]);

  const pieData = useMemo(() => {
    const labels = accounts.map((a) => a.name?.trim() || "Account");
    const values = accounts.map((a) => Math.max(0, a.balance));
    return { labels, values };
  }, [accounts]);

  const planSimAvalanche = useMemo(() => {
    const extra = Math.max(0, settings.extraMonthly);
    return simulatePayoff(accounts, "avalanche", extra, { monthsCap: 600, wantMonths: expanded6 ? 6 : 1 });
  }, [accounts, settings.extraMonthly, expanded6]);

  const planSimSnowball = useMemo(() => {
    const extra = Math.max(0, settings.extraMonthly);
    return simulatePayoff(accounts, "snowball", extra, { monthsCap: 600, wantMonths: expanded6 ? 6 : 1 });
  }, [accounts, settings.extraMonthly, expanded6]);

  const chosenSim = settings.payoffStyle === "avalanche" ? planSimAvalanche : planSimSnowball;

  const thisMonthPlan = chosenSim.monthPlans[0];
  const nextMonthsPlans = chosenSim.monthPlans.slice(0, expanded6 ? 6 : 1);

  // ===== account ops =====
  function addAccount() {
    const a: Account = {
      id: uid(),
      name: "",
      type: "Credit Card",
      balance: 0,
      limit: 0,
      apr: 0,
      minPay: 0,
      dueDate: 1,
      notes: "",
      createdAt: Date.now(),
    };
    saveAccounts([a, ...accounts]);
    setSelectedAccountId(a.id);
  }

  function updateAccount(id: string, patch: Partial<Account>) {
    const next = accounts.map((a) => (a.id === id ? { ...a, ...patch } : a));
    saveAccounts(next);
  }

  function deleteAccount(id: string) {
    const next = accounts.filter((a) => a.id !== id);
    saveAccounts(next);
    if (selectedAccountId === id) setSelectedAccountId(null);
  }

  const selectedAccount = accounts.find((a) => a.id === selectedAccountId) ?? null;

  // ===== UI pieces =====
  function Header() {
    const signedName = plan === "guest" ? "Guest" : (currentUser?.displayName?.trim() || "Signed in");
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "22px 16px 8px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              aria-label="logo"
              style={{
                width: 42,
                height: 42,
                borderRadius: 14,
                background: "rgba(255,255,255,0.75)",
                border: "1px solid rgba(0,0,0,0.10)",
                display: "grid",
                placeItems: "center",
                fontWeight: 1000,
              }}
            >
              CP
            </div>
            <div style={{ display: "grid", gap: 2 }}>
              <div style={{ fontSize: 22, fontWeight: 1000, letterSpacing: -0.3 }}>{APP_NAME}</div>
              <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.75 }}>{TAGLINE}</div>
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Pill>Plan: {plan === "guest" ? "Guest" : session?.plan === "pro" ? "Pro" : "Basic"}</Pill>
            <Pill>Supabase: {supabaseConnected ? "connected" : "not connected"}</Pill>
            <Pill>{signedName}</Pill>
            {plan === "guest" ? (
              <Button variant="ghost" onClick={() => setTab("profile")}>
                Sign in
              </Button>
            ) : (
              <Button variant="ghost" onClick={signOut}>
                Sign out
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  function GuestBanner() {
    if (plan !== "guest") return null;
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "10px 16px 0" }}>
        <div
          style={{
            borderRadius: 18,
            padding: 14,
            border: "1px solid rgba(0,0,0,0.12)",
            background: "linear-gradient(135deg, rgba(255,255,255,0.75), rgba(245,255,205,0.55))",
            boxShadow: "0 10px 24px rgba(0,0,0,0.08)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "grid", gap: 6 }}>
            <div style={{ fontWeight: 1000 }}>Guest mode: explore freely — nothing saves yet.</div>
            <div style={{ fontWeight: 900, opacity: 0.75, fontSize: 13 }}>
              Create Basic to save locally. Promo unlocks Pro.
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Button onClick={() => { setAuthMode("create"); setSelectedPlan("basic"); setTab("profile"); }}>
              Create Basic
            </Button>
            <Button variant="ghost" onClick={() => { setAuthMode("signin"); setTab("profile"); }}>
              Sign in
            </Button>
          </div>
        </div>
      </div>
    );
  }

  function Tabs() {
    const tabs: { key: typeof tab; label: string }[] = [
      { key: "dashboard", label: "Dashboard" },
      { key: "accounts", label: "Accounts" },
      { key: "plan", label: "Plan" },
      { key: "profile", label: "Profile" },
    ];
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 16px 0" }}>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              style={{
                padding: "10px 14px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.12)",
                background: tab === t.key ? "rgba(255,255,255,0.78)" : "rgba(255,255,255,0.55)",
                fontWeight: 1000,
                cursor: "pointer",
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  function Dashboard() {
    const hello = plan === "guest" ? "Hello" : `Hello, ${currentUser?.displayName?.trim() || emailNorm}`;
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 16px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, alignItems: "start" }}>
          <Card>
            <div style={{ display: "grid", gap: 10 }}>
              <div>
                <div style={{ fontSize: 22, fontWeight: 1000 }}>{hello}</div>
                <div style={{ fontSize: 13, fontWeight: 900, opacity: 0.75 }}>
                  Your payoff scoreboard — fast to read, built to push action.
                </div>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Pill>Total debt: {money(totals.totalDebt)}</Pill>
                <Pill>Total min pay: {money(totals.totalMin)}</Pill>
                <Pill>Interest/mo: {money(totals.interestThisMonth)}</Pill>
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                <Card>
                  <PieChart title="Balances" labels={pieData.labels} values={pieData.values} />
                </Card>
                <Card>
                  <UsageBars rows={usageRows} />
                </Card>
              </div>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Button onClick={() => { setTab("accounts"); addAccount(); }}>+ Add account</Button>
                <Button variant="ghost" onClick={() => setTab("accounts")}>View accounts</Button>
                <Button variant="ghost" onClick={() => setTab("plan")}>View plan</Button>
              </div>
            </div>
          </Card>

          <div style={{ display: "grid", gap: 14 }}>
            <Card>
              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontWeight: 1000, fontSize: 16 }}>Pro insight: snapshot</div>
                <div style={{ fontWeight: 900, opacity: 0.8 }}>
                  {money(totals.interestThisMonth)} interest / {money(totals.totalMin)} minimums
                </div>
                <div style={{ fontWeight: 900, opacity: 0.8 }}>Total debt: {money(totals.totalDebt)}</div>
                <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7 }}>
                  This uses all accounts (not one).
                </div>
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 1000, fontSize: 16, marginBottom: 10 }}>Quick totals</div>
              <div style={{ display: "grid", gap: 6, fontWeight: 900, opacity: 0.85 }}>
                <div>Total debt: {money(totals.totalDebt)}</div>
                <div>Total min pay: {money(totals.totalMin)}</div>
                <div>Interest/mo: {money(totals.interestThisMonth)}</div>
              </div>
            </Card>

            <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.6, paddingLeft: 4 }}>
              Demo build • Local storage • Supabase reset optional
            </div>
          </div>
        </div>
      </div>
    );
  }

  function Accounts() {
    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 16px 28px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 18, fontWeight: 1000 }}>Accounts</div>
          <Button onClick={addAccount}>+ Add account</Button>
        </div>

        <div style={{ height: 12 }} />

        <div style={{ display: "grid", gap: 12 }}>
          {accounts.length === 0 && (
            <Card>
              <div style={{ fontWeight: 900, opacity: 0.75 }}>No accounts yet. Add one to start building your plan.</div>
            </Card>
          )}

          {accounts.map((a) => {
            const isOpen = selectedAccountId === a.id;

            // derived
            const usagePct = a.limit > 0 ? clamp((a.balance / a.limit) * 100, 0, 999) : 0;

            // per-account schedule (minimum only)
            const minOnly = simulatePayoff([a], "avalanche", 0, { monthsCap: 600, wantMonths: 12 });
            const stalled = minOnly.stalled && a.balance > 0.01 && a.minPay <= 0;

            return (
              <Card key={a.id}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontSize: 16, fontWeight: 1000 }}>{a.name?.trim() || "Unnamed account"}</div>
                      <Pill>{a.type}</Pill>
                      <Pill>Due date {ordinal(clamp(a.dueDate || 1, 1, 31))}</Pill>
                      {a.limit > 0 && <Pill>Usage {Math.round(usagePct)}%</Pill>}
                    </div>
                    <div style={{ fontWeight: 900, opacity: 0.78, fontSize: 13 }}>
                      Balance {money(a.balance)} • Limit {money(a.limit)} • APR {a.apr.toFixed(2)}% • Min {money(a.minPay)}/mo
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <Button variant="ghost" onClick={() => setSelectedAccountId(isOpen ? null : a.id)}>
                      {isOpen ? "Close" : "Open"}
                    </Button>
                    <Button variant="danger" onClick={() => deleteAccount(a.id)}>
                      Delete
                    </Button>
                  </div>
                </div>

                {isOpen && (
                  <div style={{ marginTop: 14, display: "grid", gap: 14 }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr 1fr", gap: 12 }}>
                      <TextField
                        label="Name"
                        value={getDraft(a.id, "name", a.name || "")}
                        onChange={(v) => upsertDraft(a.id, "name", v)}
                        onBlur={() => {
                          updateAccount(a.id, { name: getDraft(a.id, "name", a.name || "").trim() });
                          clearDraft(a.id, "name");
                        }}
                        placeholder="e.g., CHASE"
                      />

                      <SelectField
                        label="Type"
                        value={a.type}
                        onChange={(v) => updateAccount(a.id, { type: v as AccountType })}
                        options={[
                          { value: "Credit Card", label: "Credit Card" },
                          { value: "Loan", label: "Loan" },
                          { value: "Line of Credit", label: "Line of Credit" },
                          { value: "Other", label: "Other" },
                        ]}
                      />

                      <SelectField
                        label="Due date"
                        value={String(clamp(a.dueDate || 1, 1, 31))}
                        onChange={(v) => updateAccount(a.id, { dueDate: clamp(parseInt(v, 10) || 1, 1, 31) })}
                        options={Array.from({ length: 31 }).map((_, i) => {
                          const day = i + 1;
                          return { value: String(day), label: ordinal(day) };
                        })}
                      />
                    </div>

                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 12 }}>
                      <TextField
                        label="Balance"
                        value={getDraft(a.id, "balance", fmtMoneyInput(a.balance))}
                        onChange={(v) => upsertDraft(a.id, "balance", keepNumericChars(v, true))}
                        onBlur={() => {
                          const n = parseMoneyLike(getDraft(a.id, "balance", fmtMoneyInput(a.balance)));
                          updateAccount(a.id, { balance: Math.max(0, n) });
                          clearDraft(a.id, "balance");
                        }}
                        placeholder="0"
                        inputMode="decimal"
                      />

                      <TextField
                        label="Limit"
                        value={getDraft(a.id, "limit", fmtMoneyInput(a.limit))}
                        onChange={(v) => upsertDraft(a.id, "limit", keepNumericChars(v, true))}
                        onBlur={() => {
                          const n = parseMoneyLike(getDraft(a.id, "limit", fmtMoneyInput(a.limit)));
                          updateAccount(a.id, { limit: Math.max(0, n) });
                          clearDraft(a.id, "limit");
                        }}
                        placeholder="0"
                        inputMode="decimal"
                      />

                      <TextField
                        label="APR %"
                        value={getDraft(a.id, "apr", fmtPercentInput(a.apr))}
                        onChange={(v) => upsertDraft(a.id, "apr", keepNumericChars(v, true))}
                        onBlur={() => {
                          const n = parsePercentLike(getDraft(a.id, "apr", fmtPercentInput(a.apr)));
                          updateAccount(a.id, { apr: clamp(n, 0, 99.99) });
                          clearDraft(a.id, "apr");
                        }}
                        placeholder="29.99"
                        inputMode="decimal"
                      />

                      <TextField
                        label="Next min payment"
                        value={getDraft(a.id, "minPay", fmtMoneyInput(a.minPay))}
                        onChange={(v) => upsertDraft(a.id, "minPay", keepNumericChars(v, true))}
                        onBlur={() => {
                          const n = parseMoneyLike(getDraft(a.id, "minPay", fmtMoneyInput(a.minPay)));
                          updateAccount(a.id, { minPay: Math.max(0, n) });
                          clearDraft(a.id, "minPay");
                        }}
                        placeholder="0"
                        inputMode="decimal"
                      />
                    </div>

                    <TextField
                      label="Notes"
                      value={getDraft(a.id, "notes", a.notes || "")}
                      onChange={(v) => upsertDraft(a.id, "notes", v)}
                      onBlur={() => {
                        updateAccount(a.id, { notes: getDraft(a.id, "notes", a.notes || "") });
                        clearDraft(a.id, "notes");
                      }}
                      placeholder="Optional"
                    />

                    <div style={{ display: "grid", gap: 8 }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
                        <div style={{ fontSize: 16, fontWeight: 1000 }}>Monthly schedule (minimum only)</div>
                        <Pill>
                          Months: {a.balance > 0.01 ? (minOnly.stalled ? "—" : String(minOnly.monthsToPayoff)) : "0"}
                        </Pill>
                      </div>

                      {a.balance <= 0.01 ? (
                        <div style={{ fontWeight: 900, opacity: 0.75 }}>Balance is $0. Add a balance to generate the schedule.</div>
                      ) : stalled ? (
                        <div style={{ fontWeight: 900, opacity: 0.75 }}>
                          Set a minimum payment to generate the schedule.
                        </div>
                      ) : minOnly.stalled ? (
                        <div style={{ fontWeight: 900, opacity: 0.75 }}>
                          Payment is too low to reduce the balance. Increase minimum payment or reduce APR/balance.
                        </div>
                      ) : (
                        <div style={{ overflowX: "auto" }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                            <thead>
                              <tr style={{ textAlign: "left", opacity: 0.75 }}>
                                <th style={{ padding: "8px 6px" }}>Month</th>
                                <th style={{ padding: "8px 6px" }}>Total paid</th>
                                <th style={{ padding: "8px 6px" }}>Interest</th>
                                <th style={{ padding: "8px 6px" }}>Remaining</th>
                              </tr>
                            </thead>
                            <tbody>
                              {minOnly.monthPlans.slice(0, 12).map((mp) => (
                                <tr key={mp.monthIndex} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                                  <td style={{ padding: "8px 6px", fontWeight: 900 }}>{mp.monthIndex}</td>
                                  <td style={{ padding: "8px 6px", fontWeight: 900 }}>{money(mp.totalPaid)}</td>
                                  <td style={{ padding: "8px 6px", fontWeight: 900 }}>{money(mp.totalInterest)}</td>
                                  <td style={{ padding: "8px 6px", fontWeight: 900 }}>{money(mp.remainingDebt)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      </div>
    );
  }

  function Plan() {
    // Hide email + promo: we show plan logic, not credentials
    const showMonthRows = (mp: MonthPlan | undefined) => {
      if (!mp) return null;
      return (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.75 }}>
                <th style={{ padding: "8px 6px" }}>Account</th>
                <th style={{ padding: "8px 6px" }}>Min</th>
                <th style={{ padding: "8px 6px" }}>Extra</th>
                <th style={{ padding: "8px 6px" }}>Total</th>
              </tr>
            </thead>
            <tbody>
              {mp.allocations.map((r) => (
                <tr key={r.accountId} style={{ borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                  <td style={{ padding: "8px 6px", fontWeight: 1000 }}>{r.name}</td>
                  <td style={{ padding: "8px 6px", fontWeight: 900 }}>{money(r.min)}</td>
                  <td style={{ padding: "8px 6px", fontWeight: 900 }}>{money(r.extra)}</td>
                  <td style={{ padding: "8px 6px", fontWeight: 1000 }}>{money(r.total)}</td>
                </tr>
              ))}
              <tr style={{ borderTop: "1px solid rgba(0,0,0,0.12)" }}>
                <td style={{ padding: "10px 6px", fontWeight: 1000 }}>TOTAL</td>
                <td style={{ padding: "10px 6px", fontWeight: 1000 }}>{money(mp.totalMin)}</td>
                <td style={{ padding: "10px 6px", fontWeight: 1000 }}>{money(mp.totalExtra)}</td>
                <td style={{ padding: "10px 6px", fontWeight: 1000 }}>{money(mp.totalPaid)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      );
    };

    const outcomeBox = (title: string, sim: SimResult, explainer: string) => (
      <Card>
        <div style={{ display: "grid", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 1000 }}>{title}</div>
          <div style={{ fontWeight: 900 }}>Payoff time: {sim.stalled ? "—" : `${sim.monthsToPayoff} mo`}</div>
          <div style={{ fontWeight: 900 }}>Total interest: {money(sim.totalInterest)}</div>
          <div style={{ fontWeight: 900, opacity: 0.75 }}>{explainer}</div>
        </div>
      </Card>
    );

    const ranked = rankAccounts(accounts, settings.payoffStyle).map((id) => accounts.find((a) => a.id === id)).filter(Boolean) as Account[];

    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 16px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 14 }}>
          <Card>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <SelectField
                  label="Payoff style"
                  value={settings.payoffStyle}
                  onChange={(v) =>
                    saveSettings({
                      ...settings,
                      payoffStyle: v as Settings["payoffStyle"],
                    })
                  }
                  options={[
                    { value: "avalanche", label: "Avalanche (save interest over time)" },
                    { value: "snowball", label: "Snowball (faster wins first)" },
                  ]}
                />

                <TextField
                  label="Extra this month (rolls forward)"
                  value={getDraft("settings", "extra", fmtMoneyInput(settings.extraMonthly))}
                  onChange={(v) => upsertDraft("settings", "extra", keepNumericChars(v, true))}
                  onBlur={() => {
                    const n = parseMoneyLike(getDraft("settings", "extra", fmtMoneyInput(settings.extraMonthly)));
                    saveSettings({ ...settings, extraMonthly: Math.max(0, n) });
                    clearDraft("settings", "extra");
                  }}
                  placeholder="0"
                  inputMode="decimal"
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                {outcomeBox(
                  "Avalanche outcome",
                  planSimAvalanche,
                  "Highest APR first. Usually cheaper over time."
                )}
                {outcomeBox(
                  "Snowball outcome",
                  planSimSnowball,
                  "Smallest balance first. Faster wins, sometimes more interest."
                )}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 1000 }}>This month payment plan</div>
                    <div style={{ fontWeight: 900, opacity: 0.75 }}>
                      Min + Extra = Total payment. Extra rolls into next target if one gets paid off.
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Pill>Extra: {money(settings.extraMonthly)}</Pill>
                    <Pill>Total this month: {money(thisMonthPlan?.totalPaid ?? 0)}</Pill>
                    <Button variant="ghost" onClick={() => setExpanded6((v) => !v)}>
                      {expanded6 ? "Collapse" : "Expand (next 6 months)"}
                    </Button>
                  </div>
                </div>

                {accounts.filter((a) => a.balance > 0.01).length === 0 ? (
                  <div style={{ fontWeight: 900, opacity: 0.75 }}>
                    Add accounts with balances to generate a plan.
                  </div>
                ) : chosenSim.stalled ? (
                  <div style={{ fontWeight: 900, opacity: 0.75 }}>
                    Plan is stalled. Check that each account has a minimum payment and APR is set correctly.
                  </div>
                ) : (
                  <div style={{ display: "grid", gap: 12 }}>
                    {showMonthRows(thisMonthPlan)}

                    {expanded6 && (
                      <Card>
                        <div style={{ display: "grid", gap: 10 }}>
                          <div style={{ fontSize: 16, fontWeight: 1000 }}>Next 6 months (preview)</div>
                          <div style={{ fontWeight: 900, opacity: 0.75 }}>
                            This is based on your current minimums + extra, with rollover into the next target.
                          </div>

                          <div style={{ display: "grid", gap: 14 }}>
                            {nextMonthsPlans.slice(0, 6).map((mp) => (
                              <div key={mp.monthIndex} style={{ display: "grid", gap: 8 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                                  <div style={{ fontWeight: 1000 }}>Month {mp.monthIndex}</div>
                                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                    <Pill>Total paid: {money(mp.totalPaid)}</Pill>
                                    <Pill>Interest: {money(mp.totalInterest)}</Pill>
                                    <Pill>Remaining: {money(mp.remainingDebt)}</Pill>
                                  </div>
                                </div>
                                {showMonthRows(mp)}
                              </div>
                            ))}
                          </div>
                        </div>
                      </Card>
                    )}
                  </div>
                )}
              </div>

              <div style={{ display: "grid", gap: 10 }}>
                <div style={{ fontSize: 18, fontWeight: 1000 }}>
                  Pay first ({settings.payoffStyle === "avalanche" ? "highest APR → lowest" : "smallest balance → largest"})
                </div>
                {ranked.length === 0 ? (
                  <div style={{ fontWeight: 900, opacity: 0.75 }}>Add accounts to see ranked targets.</div>
                ) : (
                  <div style={{ display: "grid", gap: 8 }}>
                    {ranked.slice(0, 8).map((a, idx) => (
                      <div key={a.id} style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <div style={{ fontWeight: 1000 }}>
                          {idx + 1}. {a.name?.trim() || "Account"}
                        </div>
                        <div style={{ fontWeight: 900, opacity: 0.8 }}>
                          APR {a.apr.toFixed(2)}% • Bal {money(a.balance)} • Min {money(a.minPay)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Pro page graphic requirement: keep at least one graphic */}
              <div style={{ display: "grid", gap: 12 }}>
                <Card>
                  <UsageBars rows={usageRows} />
                </Card>
              </div>
            </div>
          </Card>
        </div>
      </div>
    );
  }

  function Profile() {
    const showPromoField = plan === "guest"; // never show promo after sign-in
    const planOptions =
      authMode === "create"
        ? [
            { value: "basic", label: "Basic" },
            { value: "pro", label: "Pro (coming soon)" },
          ]
        : [{ value: "basic", label: "Basic" }];

    return (
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "14px 16px 28px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14, alignItems: "start" }}>
          <Card>
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ fontSize: 18, fontWeight: 1000 }}>Profile</div>

              {plan === "guest" ? (
                <>
                  <div style={{ display: "flex", gap: 10 }}>
                    <Button variant={authMode === "signin" ? "primary" : "ghost"} onClick={() => setAuthMode("signin")}>
                      Sign in
                    </Button>
                    <Button variant={authMode === "create" ? "primary" : "ghost"} onClick={() => setAuthMode("create")}>
                      Create account
                    </Button>
                  </div>

                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 12 }}>
                    <TextField
                      label="Email"
                      value={authEmail}
                      onChange={setAuthEmail}
                      placeholder="you@email.com"
                      inputMode="email"
                    />

                    <SelectField
                      label="Plan"
                      value={selectedPlan}
                      onChange={(v) => setSelectedPlan(v as Exclude<Plan, "guest">)}
                      options={planOptions}
                    />
                  </div>

                  <TextField
                    label="Password"
                    value={authPassword}
                    onChange={setAuthPassword}
                    placeholder="At least 8 characters"
                  />

                  {showPromoField && (
                    <TextField
                      label="Promo code (optional)"
                      value={promoCode}
                      onChange={setPromoCode}
                      placeholder="Enter promo code"
                    />
                  )}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Button onClick={authMode === "signin" ? signInUser : createUser}>
                      {authMode === "signin" ? "Sign in" : "Create & sign in"}
                    </Button>
                    <Button variant="ghost" onClick={forgotPassword}>
                      Forgot password?
                    </Button>
                  </div>

                  <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.7 }}>
                    Reset: email reset (Supabase) or local reset (deletes local data).
                  </div>
                </>
              ) : (
                <>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                    <TextField
                      label="Display name"
                      value={getDraft("profile", "displayName", currentUser?.displayName ?? "")}
                      onChange={(v) => upsertDraft("profile", "displayName", v)}
                      onBlur={() => {
                        const name = getDraft("profile", "displayName", currentUser?.displayName ?? "").trim();
                        const usersNow = lsGet<UserRec[]>(KEY_USERS) ?? [];
                        const idx = usersNow.findIndex((u) => normalizeEmail(u.email) === emailNorm);
                        if (idx >= 0) {
                          usersNow[idx] = { ...usersNow[idx], displayName: name };
                          lsSet(KEY_USERS, usersNow);
                        }
                        clearDraft("profile", "displayName");
                        setStatusMsg("Saved.");
                      }}
                      placeholder="e.g., Anthony"
                    />

                    <div style={{ display: "grid", gap: 6 }}>
                      <div style={{ fontSize: 12, fontWeight: 900, opacity: 0.75 }}>Plan</div>
                      <div style={{ padding: "11px 12px", borderRadius: 12, border: "1px solid rgba(0,0,0,0.16)", background: "rgba(255,255,255,0.78)", fontWeight: 1000 }}>
                        {session?.plan === "pro" ? "Pro" : "Basic"}
                      </div>
                    </div>
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Button variant="ghost" onClick={signOut}>Sign out</Button>
                  </div>
                </>
              )}

              {statusMsg && (
                <div style={{ fontWeight: 900, opacity: 0.75, paddingTop: 6 }}>{statusMsg}</div>
              )}
            </div>
          </Card>

          <div style={{ display: "grid", gap: 14 }}>
            <Card>
              <div style={{ fontWeight: 1000, marginBottom: 8 }}>What you’ll get</div>
              <div style={{ fontWeight: 900, opacity: 0.8, display: "grid", gap: 6 }}>
                <div>• Usage % scoreboard</div>
                <div>• Avalanche vs Snowball</div>
                <div>• Monthly action list</div>
              </div>
            </Card>

            <Card>
              <div style={{ fontWeight: 1000, marginBottom: 8 }}>Quick totals</div>
              <div style={{ fontWeight: 900, opacity: 0.85, display: "grid", gap: 6 }}>
                <div>Total debt: {money(totals.totalDebt)}</div>
                <div>Total min pay: {money(totals.totalMin)}</div>
                <div>Interest/mo: {money(totals.interestThisMonth)}</div>
              </div>
            </Card>

            {/* Graphic requirement (even here it’s fine) */}
            <Card>
              <PieChart title="Balances" labels={pieData.labels} values={pieData.values} />
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={pageStyle}>
      {/* spinner removal + nicer mobile feel */}
      <style>{`
        input::-webkit-outer-spin-button,
        input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
        input[type=number] { -moz-appearance: textfield; }
      `}</style>

      <Header />
      <GuestBanner />
      <Tabs />

      {tab === "dashboard" && <Dashboard />}
      {tab === "accounts" && <Accounts />}
      {tab === "plan" && <Plan />}
      {tab === "profile" && <Profile />}
    </div>
  );
}
