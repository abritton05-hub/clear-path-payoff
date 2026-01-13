"use client";

import React, { useEffect, useMemo, useState } from "react";

/**
 * Clear Path Payoff — single-file build (Next.js App Router)
 * Paste into: src/app/page.tsx
 *
 * Notes:
 * - Demo auth is localStorage-based (NOT production secure yet).
 * - Pro-only: click into an account for details.
 * - Reduced ads for Pro: compact + only on Plan/Profile.
 * - Guest: big bright banner; nothing saves.
 */

// ====== CONFIG ======
const APP_NAME = "Clear Path Payoff";
const MASTER_EMAIL = "abritton05@gmail.com"; // you always get Pro

// localStorage keys
const KEY_USERS = "cpp_users_v1";
const KEY_SESSION = "cpp_session_v1";
const KEY_ACCOUNTS_PREFIX = "cpp_accounts_v1_"; // + email
const KEY_SETTINGS_PREFIX = "cpp_settings_v1_"; // + email

type Plan = "basic" | "pro";
type AccountType = "credit_card" | "loan";
type Tab = "accounts" | "plan" | "stats" | "profile";
type AuthMode = "signin" | "signup";

type User = {
  email: string;
  password: string; // demo only
  plan: Plan;
  name: string;
};

type Session = {
  email: string;
  plan: Plan;
  name: string;
  isGuest: boolean;
};

type Account = {
  id: string;
  type: AccountType;
  name: string;
  apr: number;
  balance: number;
  minPayment: number;
  nextDueDay: number; // 1-31
  creditLimit?: number;
  createdAt: number;
};

type Settings = {
  amountExtra: number; // monthly extra budget
  method: "avalanche" | "snowball";
};

// ====== HELPERS ======
function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
function safeParse<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}
function accountsKey(email: string) {
  return KEY_ACCOUNTS_PREFIX + normalizeEmail(email);
}
function settingsKey(email: string) {
  return KEY_SETTINGS_PREFIX + normalizeEmail(email);
}
function money(n: number) {
  if (!isFinite(n)) return "$0.00";
  return n.toLocaleString(undefined, { style: "currency", currency: "USD" });
}
function pct(n: number) {
  if (!isFinite(n)) return "0%";
  return `${n.toFixed(1)}%`;
}
function capWords(s: string) {
  const t = (s ?? "").trim();
  if (!t) return "";
  return t
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");
}
function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

// ====== STORAGE ======
function loadUsers(): User[] {
  const raw = localStorage.getItem(KEY_USERS);
  const parsed = safeParse<any>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((u) => u && typeof u.email === "string" && typeof u.password === "string")
    .map((u) => ({
      email: normalizeEmail(u.email),
      password: String(u.password),
      plan: u.plan === "pro" ? "pro" : "basic",
      name: typeof u.name === "string" ? u.name : normalizeEmail(u.email),
    }));
}
function saveUsers(users: User[]) {
  localStorage.setItem(KEY_USERS, JSON.stringify(users));
}
function loadSession(): Session | null {
  const raw = localStorage.getItem(KEY_SESSION);
  const s = safeParse<any>(raw, null);
  if (!s || typeof s !== "object") return null;
  if (typeof s.email !== "string" || typeof s.plan !== "string" || typeof s.name !== "string") return null;
  return {
    email: normalizeEmail(s.email),
    plan: s.plan === "pro" ? "pro" : "basic",
    name: String(s.name),
    isGuest: !!s.isGuest,
  };
}
function saveSession(session: Session | null) {
  if (!session) localStorage.removeItem(KEY_SESSION);
  else localStorage.setItem(KEY_SESSION, JSON.stringify(session));
}
function loadAccounts(email: string): Account[] {
  const raw = localStorage.getItem(accountsKey(email));
  const parsed = safeParse<any>(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((a) => a && typeof a.id === "string" && typeof a.name === "string")
    .map((a) => ({
      id: String(a.id),
      type: a.type === "loan" ? "loan" : "credit_card",
      name: String(a.name),
      apr: Number(a.apr) || 0,
      balance: Number(a.balance) || 0,
      minPayment: Number(a.minPayment) || 0,
      nextDueDay: Number(a.nextDueDay) || 1,
      creditLimit: a.creditLimit === undefined ? undefined : Number(a.creditLimit) || 0,
      createdAt: Number(a.createdAt) || Date.now(),
    }));
}
function saveAccounts(email: string, accounts: Account[]) {
  localStorage.setItem(accountsKey(email), JSON.stringify(accounts));
}
function loadSettings(email: string): Settings {
  const raw = localStorage.getItem(settingsKey(email));
  const parsed = safeParse<any>(raw, null);
  if (!parsed || typeof parsed !== "object") {
    return { amountExtra: 0, method: "avalanche" };
  }
  const amountExtra = Number(parsed.amountExtra);
  const method = parsed.method === "snowball" ? "snowball" : "avalanche";
  return {
    amountExtra: isFinite(amountExtra) ? amountExtra : 0,
    method,
  };
}
function saveSettings(email: string, settings: Settings) {
  localStorage.setItem(settingsKey(email), JSON.stringify(settings));
}

// ====== CALC ======
function projectMinOnly(account: Account, months = 18) {
  const rows: Array<{
    month: number;
    startBal: number;
    interest: number;
    minPay: number;
    endBal: number;
    util?: number;
  }> = [];

  let bal = Math.max(0, account.balance);
  const r = (Math.max(0, account.apr) / 100) / 12;
  const minPayBase = Math.max(0, account.minPayment);

  for (let m = 1; m <= months; m++) {
    if (bal <= 0.0001) break;
    const start = bal;
    const interest = start * r;
    let pay = minPayBase;
    if (pay > start + interest) pay = start + interest;
    const end = Math.max(0, start + interest - pay);

    const util =
      account.creditLimit && account.creditLimit > 0 ? (end / account.creditLimit) * 100 : undefined;

    rows.push({ month: m, startBal: start, interest, minPay: pay, endBal: end, util });
    bal = end;
  }
  return rows;
}

function buildPayoffPlan(accounts: Account[], amountExtra: number, method: "avalanche" | "snowball") {
  // Work with mutable balances
  const work = accounts.map((a) => ({ ...a, workBal: Math.max(0, a.balance) }));
  const rOf = (apr: number) => (Math.max(0, apr) / 100) / 12;

  const minTotal = work.reduce((s, a) => s + Math.max(0, a.minPayment), 0);
  const extra = Math.max(0, amountExtra);

  const months: Array<{
    month: number;
    interestTotal: number;
    minTotal: number;
    extraBudget: number;
    extraSpent: number;
    totalPaid: number;
    extraByAccount: Array<{ id: string; name: string; extra: number }>;
    balances: Array<{ id: string; name: string; bal: number }>;
  }> = [];

  for (let m = 1; m <= 24; m++) {
    if (work.every((a) => a.workBal <= 0.0001)) break;

    // interest accrues
    let interestTotal = 0;
    for (const a of work) {
      if (a.workBal <= 0.0001) continue;
      const interest = a.workBal * rOf(a.apr);
      a.workBal += interest;
      interestTotal += interest;
    }

    // pay minimums
    for (const a of work) {
      if (a.workBal <= 0.0001) continue;
      const pay = Math.min(a.workBal, Math.max(0, a.minPayment));
      a.workBal -= pay;
    }

    // choose target order
    const alive = work.filter((a) => a.workBal > 0.0001);
    const ordered =
      method === "avalanche"
        ? alive.sort((x, y) => (y.apr - x.apr) || (y.workBal - x.workBal))
        : alive.sort((x, y) => (x.workBal - y.workBal) || (y.apr - x.apr));

    // apply extra to targets
    let remaining = extra;
    const extraByAccount: Array<{ id: string; name: string; extra: number }> = [];

    for (const t of ordered) {
      if (remaining <= 0.0001) break;
      const spend = Math.min(remaining, t.workBal);
      t.workBal -= spend;
      remaining -= spend;
      extraByAccount.push({ id: t.id, name: t.name, extra: spend });
    }

    const extraSpent = extra - remaining;
    const totalPaid = minTotal + extraSpent;

    months.push({
      month: m,
      interestTotal,
      minTotal,
      extraBudget: extra,
      extraSpent,
      totalPaid,
      extraByAccount,
      balances: work.map((a) => ({ id: a.id, name: a.name, bal: Math.max(0, a.workBal) })),
    });
  }

  return { minTotal, months };
}

// ====== UI COMPONENTS (INLINE) ======
function LogoMark() {
  // Minimal “path/arrow” icon
  return (
    <svg width="34" height="34" viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="rgba(47,111,78,0.95)" />
          <stop offset="1" stopColor="rgba(125,187,149,0.95)" />
        </linearGradient>
      </defs>
      <rect x="6" y="6" width="52" height="52" rx="18" fill="rgba(255,255,255,0.65)" stroke="rgba(20,40,26,0.18)" />
      <path
        d="M18 40c10-18 16-20 28-14"
        stroke="url(#g)"
        strokeWidth="6"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M43 18l8 8-12 2"
        fill="url(#g)"
      />
    </svg>
  );
}

function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean;
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modalOverlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ alignItems: "flex-start" }}>
          <div>
            <div style={{ fontWeight: 900, fontSize: 16 }}>{title}</div>
          </div>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="hr" />
        {children}
      </div>
    </div>
  );
}

function AdBanner({ variant, onUpgrade }: { variant: "full" | "compact"; onUpgrade?: () => void }) {
  return (
    <div className="adDock">
      <div className={`ad ${variant === "compact" ? "compact" : ""}`}>
        <div>
          <div className="tag">SPONSORED</div>
          <div className="copy">
            {variant === "compact"
              ? "Tip: keep utilization under 30% if you can."
              : "Quick tip: paying earlier in the cycle can lower your reported utilization."}
          </div>
        </div>
        {onUpgrade ? (
          <button className="btn primary" onClick={onUpgrade}>
            Explore Pro
          </button>
        ) : (
          <button className="btn">Learn more</button>
        )}
      </div>
    </div>
  );
}

// ====== MAIN ======
export default function Page() {
  // auth state
  const [session, setSession] = useState<Session | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("signin");
  const [planPick, setPlanPick] = useState<Plan>("basic");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authMsg, setAuthMsg] = useState<{ type: "good" | "bad"; text: string } | null>(null);

  // app state
  const [tab, setTab] = useState<Tab>("accounts");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [settings, setSettings] = useState<Settings>({ amountExtra: 0, method: "avalanche" });

  // editor
  const [editorOpen, setEditorOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    type: "credit_card" as AccountType,
    name: "",
    apr: "",
    balance: "",
    minPayment: "",
    nextDueDay: "1",
    creditLimit: "",
  });
  const [toast, setToast] = useState<{ type: "good" | "bad"; text: string } | null>(null);

  // details view (Pro-only)
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [lockedOpen, setLockedOpen] = useState(false);

  // profile
  const [profileName, setProfileName] = useState("");
  const [profileShowPw, setProfileShowPw] = useState(false);
  const [profileNewPw, setProfileNewPw] = useState("");
  const [profileMsg, setProfileMsg] = useState<{ type: "good" | "bad"; text: string } | null>(null);

  // load session once
  useEffect(() => {
    const s = loadSession();
    if (s) setSession(s);
  }, []);

  // load accounts/settings when session changes
  useEffect(() => {
    if (!session) return;
    if (session.isGuest) {
      setAccounts([]);
      setSettings({ amountExtra: 0, method: "avalanche" });
      setProfileName(session.name || "Guest");
      return;
    }
    const a = loadAccounts(session.email);
    setAccounts(a);
    const st = loadSettings(session.email);
    setSettings(st);
    setProfileName(session.name || session.email);
  }, [session?.email, session?.isGuest]);

  const isMaster = session?.email === MASTER_EMAIL;
  const isPro = !!session && !session.isGuest && (session.plan === "pro" || isMaster);

  // reduced ads for pro: only show on Plan or Profile (compact)
  const showAds = useMemo(() => {
    if (!session) return false;
    if (session.isGuest) return true; // guest sees ads
    if (isPro) return tab === "plan" || tab === "profile";
    return true; // basic sees ads on all tabs
  }, [session, tab, isPro]);

  const adVariant: "full" | "compact" = isPro ? "compact" : "full";

  // payoff plan
  const payoff = useMemo(() => {
    const extra = Math.max(0, settings.amountExtra || 0);
    return buildPayoffPlan(accounts, extra, settings.method);
  }, [accounts, settings.amountExtra, settings.method]);

  const totalBalance = useMemo(() => accounts.reduce((s, a) => s + Math.max(0, a.balance), 0), [accounts]);
  const totalMin = useMemo(() => accounts.reduce((s, a) => s + Math.max(0, a.minPayment), 0), [accounts]);

  // details account
  const selectedAccount = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );
  const detailsRows = useMemo(() => (selectedAccount ? projectMinOnly(selectedAccount, 18) : []), [selectedAccount]);

  // ====== AUTH ACTIONS ======
  function signOut() {
    saveSession(null);
    setSession(null);
    setAuthEmail("");
    setAuthPassword("");
    setAuthMsg(null);
    setTab("accounts");
    setSelectedAccountId(null);
  }

  function continueAsGuest() {
    const guest: Session = {
      email: "guest",
      plan: "basic",
      name: "Guest",
      isGuest: true,
    };
    saveSession(guest);
    setSession(guest);
    setAuthMsg(null);
    setTab("accounts");
  }

  function handleAuthSubmit(e: React.FormEvent) {
    e.preventDefault();
    const email = normalizeEmail(authEmail);
    const pw = authPassword;

    if (!email || !pw) {
      setAuthMsg({ type: "bad", text: "Email and password are required." });
      return;
    }

    const users = loadUsers();
    const existing = users.find((u) => u.email === email);

    if (authMode === "signup") {
      if (planPick === "pro") {
        // Pro coming soon: block create
        setAuthMsg({ type: "bad", text: "Pro is coming soon. Choose Basic to create an account today." });
        return;
      }
      if (existing) {
        setAuthMsg({ type: "bad", text: "That account already exists. Please sign in." });
        setAuthMode("signin");
        return;
      }
      const newUser: User = {
        email,
        password: pw,
        plan: "basic",
        name: email, // default name = email
      };
      saveUsers([...users, newUser]);
      setAuthMsg({ type: "good", text: "Account created. Now sign in." });
      setAuthMode("signin");
      return;
    }

    // signin
    if (!existing) {
      setAuthMsg({ type: "bad", text: "No account found. Create one first." });
      return;
    }
    if (existing.password !== pw) {
      setAuthMsg({ type: "bad", text: "Wrong password." });
      return;
    }

    const sess: Session = {
      email,
      plan: existing.plan,
      name: existing.name || email,
      isGuest: false,
    };
    saveSession(sess);
    setSession(sess);
    setAuthMsg(null);
    setTab("accounts");
  }

  // ====== ACCOUNT EDITOR ======
  function openAdd() {
    if (!session || session.isGuest) {
      setToast({ type: "bad", text: "Guest mode doesn’t save. Create an account to save your data." });
      return;
    }
    setEditId(null);
    setForm({
      type: "credit_card",
      name: "",
      apr: "",
      balance: "",
      minPayment: "",
      nextDueDay: "1",
      creditLimit: "",
    });
    setEditorOpen(true);
  }

  function openEdit(account: Account) {
    if (!session || session.isGuest) {
      setToast({ type: "bad", text: "Guest mode doesn’t save. Create an account to save your data." });
      return;
    }
    setEditId(account.id);
    setForm({
      type: account.type,
      name: account.name,
      apr: String(account.apr),
      balance: String(account.balance),
      minPayment: String(account.minPayment),
      nextDueDay: String(account.nextDueDay),
      creditLimit: account.creditLimit !== undefined ? String(account.creditLimit) : "",
    });
    setEditorOpen(true);
  }

  function saveAccount() {
    if (!session || session.isGuest) return;

    const name = capWords(form.name);
    const apr = Number(form.apr);
    const balance = Number(form.balance);
    const minPayment = Number(form.minPayment);
    const nextDueDay = Number(form.nextDueDay);
    const creditLimit = form.creditLimit.trim() === "" ? undefined : Number(form.creditLimit);

    if (!name || !isFinite(apr) || !isFinite(balance) || !isFinite(minPayment) || !isFinite(nextDueDay)) {
      setToast({ type: "bad", text: "Missing or invalid fields. Please fill everything required." });
      return;
    }
    if (nextDueDay < 1 || nextDueDay > 31) {
      setToast({ type: "bad", text: "Next due date must be 1–31." });
      return;
    }
    if (form.type === "credit_card" && creditLimit !== undefined && creditLimit > 0 && balance > creditLimit) {
      setToast({ type: "bad", text: "Balance is higher than limit. You can save it, but consider checking the numbers." });
      // allow save anyway
    }

    const updated: Account = {
      id: editId || uid(),
      type: form.type,
      name,
      apr: Math.max(0, apr),
      balance: Math.max(0, balance),
      minPayment: Math.max(0, minPayment),
      nextDueDay,
      creditLimit: creditLimit !== undefined ? Math.max(0, creditLimit) : undefined,
      createdAt: editId ? (accounts.find(a => a.id === editId)?.createdAt ?? Date.now()) : Date.now(),
    };

    const next = editId ? accounts.map((a) => (a.id === editId ? updated : a)) : [updated, ...accounts];

    setAccounts(next);
    saveAccounts(session.email, next);
    setEditorOpen(false);
    setToast({ type: "good", text: "Account information added." });
  }

  function deleteAccount(id: string) {
    if (!session || session.isGuest) return;
    const next = accounts.filter((a) => a.id !== id);
    setAccounts(next);
    saveAccounts(session.email, next);
    if (selectedAccountId === id) setSelectedAccountId(null);
    setToast({ type: "good", text: "Account removed." });
  }

  function handleAccountClick(account: Account) {
    if (!isPro) {
      setLockedOpen(true);
      return;
    }
    setSelectedAccountId(account.id);
  }

  // ====== SETTINGS ======
  function updateSettings(next: Settings) {
    setSettings(next);
    if (session && !session.isGuest) saveSettings(session.email, next);
  }

  // ====== PROFILE ======
  function saveProfile() {
    if (!session) return;
    if (session.isGuest) {
      setProfileMsg({ type: "bad", text: "Guest mode can’t save a profile. Create an account." });
      return;
    }

    const users = loadUsers();
    const email = session.email;
    const me = users.find((u) => u.email === email);
    if (!me) {
      setProfileMsg({ type: "bad", text: "Account not found in storage. Create an account again." });
      return;
    }

    const newName = (profileName || email).trim();
    let newPw = me.password;
    if (profileNewPw.trim()) newPw = profileNewPw;

    const updatedUsers = users.map((u) =>
      u.email === email ? { ...u, name: newName, password: newPw } : u
    );
    saveUsers(updatedUsers);

    const nextSession = { ...session, name: newName };
    saveSession(nextSession);
    setSession(nextSession);

    setProfileNewPw("");
    setProfileMsg({ type: "good", text: "Profile updated." });
  }

  // ====== LOGIN SCREEN ======
  if (!session) {
    const proSelected = planPick === "pro";
    return (
      <>
        <BackgroundArt />
        <div className="app">
          <div className="topbar">
            <div className="brand">
              <LogoMark />
              <div>
                <div className="brand-name">{APP_NAME}</div>
                <div className="brand-sub">Clear, calm payoff planning</div>
              </div>
            </div>
            <div className="row" style={{ justifyContent: "flex-end", gap: 10 }}>
              <button className="btn" onClick={() => continueAsGuest()}>
                Continue as guest
              </button>
            </div>
          </div>

          <div className="grid">
            <div className="card">
              <h2>{authMode === "signin" ? "Sign in" : "Create account"}</h2>
              <div className="muted" style={{ marginBottom: 10 }}>
                Guest mode lets you try the app, but it won’t save anything.
              </div>

              <form onSubmit={handleAuthSubmit}>
                <div className="formgrid">
                  <div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Email
                    </div>
                    <input
                      className="input"
                      value={authEmail}
                      onChange={(e) => setAuthEmail(e.target.value)}
                      placeholder="you@email.com"
                      autoComplete="email"
                    />
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Password
                    </div>
                    <input
                      className="input"
                      type="password"
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      autoComplete={authMode === "signin" ? "current-password" : "new-password"}
                    />
                  </div>
                </div>

                {authMode === "signup" && (
                  <div style={{ marginTop: 12 }}>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Choose plan
                    </div>
                    <select
                      className="select"
                      value={planPick}
                      onChange={(e) => setPlanPick(e.target.value as Plan)}
                    >
                      <option value="basic">Basic (free)</option>
                      <option value="pro">Pro (coming soon)</option>
                    </select>

                    {planPick === "pro" && (
                      <div style={{ marginTop: 12 }} className="banner">
                        <h3>PRO (COMING SOON)</h3>
                        <p>This is the “win faster” version.</p>
                        <div className="hr" />
                        <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 800, color: "rgba(10,59,35,0.9)" }}>
                          <li>Click into each account for month-by-month snowball details</li>
                          <li>Advanced stats + richer infographics</li>
                          <li>Payday cycles + smarter prompts (later)</li>
                          <li>More tools, more clarity, faster progress</li>
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                <div className="row" style={{ marginTop: 14 }}>
                  {authMode === "signin" ? (
                    <button className="btn primary" type="submit">
                      Sign in
                    </button>
                  ) : (
                    <button className="btn primary" type="submit" disabled={proSelected} title={proSelected ? "Pro coming soon" : ""}>
                      {proSelected ? "Coming soon" : "Create account"}
                    </button>
                  )}

                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      setAuthMsg(null);
                      setAuthMode(authMode === "signin" ? "signup" : "signin");
                    }}
                  >
                    {authMode === "signin" ? "Create account" : "Back to sign in"}
                  </button>
                </div>

                {authMsg && <div className={`toast ${authMsg.type}`}>{authMsg.text}</div>}
              </form>

              <div className="hr" />
              <button className="smallLink" onClick={() => continueAsGuest()}>
                Continue as guest (won’t save)
              </button>
            </div>

            <div className="card">
              <h2>What you get</h2>
              <div className="muted">
                Clear Path Payoff is built for people trying to repair credit and take control fast.
              </div>
              <div className="hr" />
              <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 800 }}>
                <li>Add credit cards and loans</li>
                <li>See monthly minimum totals</li>
                <li>Choose Avalanche vs Snowball payoff strategy</li>
                <li>See exactly where your extra money goes each month</li>
                <li>Stats & charts that keep you motivated</li>
              </ul>
            </div>
          </div>
        </div>
        <GlobalStyles />
      </>
    );
  }

  // ====== APP SHELL ======
  const greetingName = (session.name || session.email).trim();
  const planLabel = isPro ? "PRO" : session.isGuest ? "GUEST" : "BASIC";

  const showGuestBanner = session.isGuest;

  return (
    <>
      <BackgroundArt />
      <div className="app">
        <div className="topbar">
          <div className="brand">
            <LogoMark />
            <div>
              <div className="brand-name">{APP_NAME}</div>
              <div className="brand-sub">Hello, {greetingName}</div>
            </div>
          </div>

          <div className="tabs">
            <button className={`tab ${tab === "accounts" ? "active" : ""}`} onClick={() => setTab("accounts")}>
              Accounts
            </button>
            <button className={`tab ${tab === "plan" ? "active" : ""}`} onClick={() => setTab("plan")}>
              Plan
            </button>
            <button className={`tab ${tab === "stats" ? "active" : ""}`} onClick={() => setTab("stats")}>
              Stats
            </button>
            <button className={`tab ${tab === "profile" ? "active" : ""}`} onClick={() => setTab("profile")}>
              Profile
            </button>
            <span className={`badge ${isPro ? "pro" : ""}`}>{planLabel}</span>
            <button className="btn" onClick={signOut}>
              Sign out
            </button>
          </div>
        </div>

        {showGuestBanner && (
          <div className="banner" style={{ marginTop: 14 }}>
            <h3>Save your progress with a free account</h3>
            <p>
              Guest mode won’t save your accounts or your plan. Creating a free account saves information and time.
            </p>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="btn primary"
                onClick={() => {
                  // Sign out to return to login screen
                  signOut();
                }}
              >
                Create free account
              </button>
              <div className="muted" style={{ fontWeight: 900 }}>
                You can edit this later.
              </div>
            </div>
          </div>
        )}

        {toast && <div className={`toast ${toast.type}`} style={{ marginTop: 14 }}>{toast.text}</div>}

        {/* CONTENT */}
        <div className="grid">
          <div className="card">
            {tab === "accounts" && (
              <>
                <div className="row">
                  <h2 style={{ margin: 0 }}>Accounts</h2>
                  <div className="row" style={{ gap: 8 }}>
                    <button className="btn primary" onClick={openAdd}>
                      Add account
                    </button>
                  </div>
                </div>
                <div className="muted">
                  Add credit cards and loans. Next due date uses day 1–31.
                </div>

                <div className="hr" />

                {selectedAccount && isPro ? (
                  <>
                    <div className="row">
                      <div>
                        <div style={{ fontWeight: 900, fontSize: 16 }}>{selectedAccount.name}</div>
                        <div className="muted" style={{ fontWeight: 900 }}>
                          Details view (minimum payments only) — shows how it snowballs if you do nothing.
                        </div>
                      </div>
                      <button className="btn" onClick={() => setSelectedAccountId(null)}>
                        Back to list
                      </button>
                    </div>

                    <div className="hr" />

                    <table className="table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Start</th>
                          <th>Interest</th>
                          <th>Min Pay</th>
                          <th>End</th>
                          <th>Util%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailsRows.map((r) => (
                          <tr key={r.month}>
                            <td>{r.month}</td>
                            <td>{money(r.startBal)}</td>
                            <td className="plus">+{money(r.interest)}</td>
                            <td className="minus">-{money(r.minPay)}</td>
                            <td style={{ fontWeight: 900 }}>{money(r.endBal)}</td>
                            <td>{r.util === undefined ? "—" : pct(r.util)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="hr" />

                    <div className="row" style={{ gap: 8 }}>
                      <button className="btn" onClick={() => openEdit(selectedAccount)}>
                        Edit
                      </button>
                      <button className="btn danger" onClick={() => deleteAccount(selectedAccount.id)}>
                        Delete
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    {accounts.length === 0 ? (
                      <div className="muted" style={{ fontWeight: 900 }}>
                        No accounts yet. Add your first one.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {accounts.map((a) => {
                          const util =
                            a.type === "credit_card" && a.creditLimit && a.creditLimit > 0
                              ? (a.balance / a.creditLimit) * 100
                              : undefined;

                          return (
                            <div key={a.id} className="card" style={{ padding: 12 }}>
                              <div className="row">
                                <button
                                  className="btn"
                                  style={{ flex: 1, textAlign: "left" }}
                                  onClick={() => handleAccountClick(a)}
                                  title={!isPro ? "Pro required for details" : "View details"}
                                >
                                  <div style={{ fontWeight: 900, fontSize: 15 }}>{a.name}</div>
                                  <div className="muted" style={{ fontWeight: 900 }}>
                                    {a.type === "credit_card" ? "Credit card" : "Loan"} · APR {a.apr.toFixed(2)}% · Next due date: day{" "}
                                    {a.nextDueDay}
                                  </div>
                                </button>

                                <div style={{ minWidth: 210, textAlign: "right" }}>
                                  <div style={{ fontWeight: 900 }}>{money(a.balance)}</div>
                                  <div className="muted" style={{ fontWeight: 900 }}>
                                    Min: {money(a.minPayment)} {util === undefined ? "" : ` · Util: ${pct(util)}`}
                                  </div>
                                </div>

                                <button className="btn" onClick={() => openEdit(a)}>Edit</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                )}
              </>
            )}

            {tab === "plan" && (
              <>
                <div className="row">
                  <h2 style={{ margin: 0 }}>Payoff Plan</h2>
                  <span className={`badge ${isPro ? "pro" : ""}`}>{isPro ? "Pro tools enabled" : "Basic plan"}</span>
                </div>

                <div className="hr" />

                <div className="formgrid">
                  <div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Payoff method
                    </div>
                    <select
                      className="select"
                      value={settings.method}
                      onChange={(e) => updateSettings({ ...settings, method: e.target.value as any })}
                    >
                      <option value="avalanche">Avalanche (highest APR first)</option>
                      <option value="snowball">Snowball (lowest balance first)</option>
                    </select>
                  </div>
                  <div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Amount extra (monthly)
                    </div>
                    <input
                      className="input"
                      value={String(settings.amountExtra ?? 0)}
                      onChange={(e) => {
                        const v = Number(e.target.value);
                        updateSettings({ ...settings, amountExtra: isFinite(v) ? v : 0 });
                      }}
                      inputMode="decimal"
                    />
                  </div>
                </div>

                <div className="hr" />

                <div className="row">
                  <div className="muted" style={{ fontWeight: 900 }}>
                    Total monthly minimum:
                  </div>
                  <div style={{ fontWeight: 900 }}>{money(totalMin)}</div>
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <div className="muted" style={{ fontWeight: 900 }}>
                    Amount extra:
                  </div>
                  <div style={{ fontWeight: 900 }}>{money(Math.max(0, settings.amountExtra || 0))}</div>
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  <div className="muted" style={{ fontWeight: 900 }}>
                    Total paid (est):
                  </div>
                  <div style={{ fontWeight: 900 }}>
                    {money(totalMin + Math.max(0, settings.amountExtra || 0))}
                  </div>
                </div>

                <div className="hr" />

                {payoff.months.length === 0 ? (
                  <div className="muted" style={{ fontWeight: 900 }}>
                    Add accounts to see a plan.
                  </div>
                ) : (
                  <>
                    <div className="muted" style={{ fontWeight: 900, marginBottom: 8 }}>
                      Shows which account gets your extra money each month.
                    </div>

                    <table className="table">
                      <thead>
                        <tr>
                          <th>Month</th>
                          <th>Interest</th>
                          <th>Min total</th>
                          <th>Extra spent</th>
                          <th>Total paid</th>
                          <th>Extra allocation</th>
                        </tr>
                      </thead>
                      <tbody>
                        {payoff.months.slice(0, 12).map((m) => (
                          <tr key={m.month}>
                            <td>{m.month}</td>
                            <td className="plus">+{money(m.interestTotal)}</td>
                            <td className="minus">-{money(m.minTotal)}</td>
                            <td className="minus">-{money(m.extraSpent)}</td>
                            <td style={{ fontWeight: 900 }}>{money(m.totalPaid)}</td>
                            <td>
                              {m.extraByAccount.length === 0
                                ? "—"
                                : m.extraByAccount
                                    .map((x) => `${x.name}: ${money(x.extra)}`)
                                    .join(" · ")}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>

                    <div className="hr" />
                    <div className="muted" style={{ fontWeight: 900 }}>
                      Tip: if you want to pay {money(1290.45)} or {money(1921.57)}, just type it into “Amount extra”.
                    </div>
                  </>
                )}
              </>
            )}

            {tab === "stats" && (
              <>
                <div className="row">
                  <h2 style={{ margin: 0 }}>Stats</h2>
                  <button className="btn" onClick={() => setToast(null)}>Clear message</button>
                </div>

                <div className="hr" />

                <div className="formgrid">
                  <StatCard title="Total balance" value={money(totalBalance)} />
                  <StatCard title="Total monthly minimum" value={money(totalMin)} />
                  <StatCard title="Extra budget" value={money(Math.max(0, settings.amountExtra || 0))} />
                  <StatCard
                    title="Plan method"
                    value={settings.method === "avalanche" ? "Avalanche" : "Snowball"}
                  />
                </div>

                <div className="hr" />

                <div className="muted" style={{ fontWeight: 900 }}>
                  Simple visual: balances by account
                </div>
                <div style={{ marginTop: 10, display: "grid", gap: 10 }}>
                  {accounts.map((a) => {
                    const w = totalBalance > 0 ? Math.round((a.balance / totalBalance) * 100) : 0;
                    return (
                      <div key={a.id} className="card" style={{ padding: 12 }}>
                        <div className="row">
                          <div style={{ fontWeight: 900 }}>{a.name}</div>
                          <div style={{ fontWeight: 900 }}>{money(a.balance)}</div>
                        </div>
                        <div style={{ height: 10, borderRadius: 999, overflow: "hidden", border: "1px solid rgba(20,40,26,0.15)", background: "rgba(255,255,255,0.55)", marginTop: 8 }}>
                          <div style={{ width: `${w}%`, height: "100%", background: "rgba(47,111,78,0.35)" }} />
                        </div>
                        <div className="muted" style={{ fontWeight: 900, marginTop: 6 }}>{w}% of total</div>
                      </div>
                    );
                  })}
                  {accounts.length === 0 && (
                    <div className="muted" style={{ fontWeight: 900 }}>
                      Add accounts to see stats.
                    </div>
                  )}
                </div>

                {!isPro && (
                  <>
                    <div className="hr" />
                    <div className="banner">
                      <h3>Pro stats are deeper</h3>
                      <p>
                        Pro adds account-level “snowball cost” tables and richer infographics.
                      </p>
                      <div className="row" style={{ marginTop: 10 }}>
                        <button className="btn primary" onClick={() => setTab("plan")}>
                          Explore Pro
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </>
            )}

            {tab === "profile" && (
              <>
                <div className="row">
                  <h2 style={{ margin: 0 }}>Profile</h2>
                  <span className={`badge ${isPro ? "pro" : ""}`}>{isPro ? "PRO enabled" : session.isGuest ? "GUEST" : "BASIC"}</span>
                </div>

                <div className="hr" />

                <div className="formgrid">
                  <div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Name
                    </div>
                    <input
                      className="input"
                      value={profileName}
                      onChange={(e) => setProfileName(e.target.value)}
                      placeholder={session.email}
                    />
                    <div className="muted" style={{ fontWeight: 900, marginTop: 6 }}>
                      Defaults to your email until you change it.
                    </div>
                  </div>

                  <div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Email
                    </div>
                    <input className="input" value={session.email} readOnly />
                    <div className="muted" style={{ fontWeight: 900, marginTop: 6 }}>
                      {session.isGuest ? "Guest mode does not save." : "Saved to your device (demo)."}
                    </div>
                  </div>
                </div>

                <div className="hr" />

                <div className="formgrid">
                  <div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Current password
                    </div>
                    <input
                      className="input"
                      value={profileShowPw ? "(hidden in demo)" : "••••••••"}
                      readOnly
                    />
                    <button className="smallLink" onClick={() => setProfileShowPw(!profileShowPw)}>
                      {profileShowPw ? "Hide" : "Show"} password
                    </button>
                    <div className="muted" style={{ fontWeight: 900, marginTop: 6 }}>
                      (Real password security will be added later.)
                    </div>
                  </div>

                  <div>
                    <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
                      Change password
                    </div>
                    <input
                      className="input"
                      value={profileNewPw}
                      onChange={(e) => setProfileNewPw(e.target.value)}
                      placeholder="New password"
                      type="password"
                      disabled={session.isGuest}
                    />
                    <div className="muted" style={{ fontWeight: 900, marginTop: 6 }}>
                      Leave blank to keep current password.
                    </div>
                  </div>
                </div>

                <div className="row" style={{ marginTop: 12 }}>
                  <button className="btn primary" onClick={saveProfile} disabled={session.isGuest}>
                    Save profile
                  </button>
                </div>

                {profileMsg && <div className={`toast ${profileMsg.type}`}>{profileMsg.text}</div>}

                <div className="hr" />

                <div className="banner">
                  <h3>Clear Path Payoff is built for momentum</h3>
                  <p>
                    Small consistent wins beat big perfect plans. Keep your plan simple and keep moving.
                  </p>
                </div>
              </>
            )}
          </div>

          {/* RIGHT SIDE PANEL */}
          <div className="card">
            <h2>Quick view</h2>
            <div className="muted" style={{ fontWeight: 900 }}>
              Your snapshot for this screen.
            </div>
            <div className="hr" />

            {tab === "accounts" && (
              <>
                <MiniStat label="Accounts" value={`${accounts.length}`} />
                <MiniStat label="Total balance" value={money(totalBalance)} />
                <MiniStat label="Total minimum" value={money(totalMin)} />
                <div className="hr" />
                {!isPro && (
                  <div className="banner">
                    <h3>Unlock account details</h3>
                    <p>Pro lets you click any account to see the month-by-month snowball effect.</p>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="btn primary" onClick={() => setTab("plan")}>
                        Explore Pro
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {tab === "plan" && (
              <>
                <MiniStat label="Method" value={settings.method === "avalanche" ? "Avalanche" : "Snowball"} />
                <MiniStat label="Monthly minimums" value={money(totalMin)} />
                <MiniStat label="Extra budget" value={money(Math.max(0, settings.amountExtra || 0))} />
                <MiniStat label="Total paid" value={money(totalMin + Math.max(0, settings.amountExtra || 0))} />
                <div className="hr" />
                <div className="muted" style={{ fontWeight: 900 }}>
                  Pro pricing (ready when you are)
                </div>
                <div className="row" style={{ marginTop: 10 }}>
                  <span className="badge">2.99 / month</span>
                  <span className="badge pro">19.99 / year</span>
                </div>
                <div className="muted" style={{ fontWeight: 900, marginTop: 8 }}>
                  Early access pricing
                </div>
              </>
            )}

            {tab === "stats" && (
              <>
                <MiniStat label="Total balance" value={money(totalBalance)} />
                <MiniStat label="Min total" value={money(totalMin)} />
                <MiniStat label="Extra" value={money(Math.max(0, settings.amountExtra || 0))} />
                <div className="hr" />
                <div className="muted" style={{ fontWeight: 900 }}>
                  Want deeper charts? Pro expands this with more breakdowns.
                </div>
              </>
            )}

            {tab === "profile" && (
              <>
                <MiniStat label="Signed in as" value={session.isGuest ? "Guest" : session.email} />
                <MiniStat label="Plan" value={isPro ? "Pro" : session.isGuest ? "Guest" : "Basic"} />
                <div className="hr" />
                {session.isGuest && (
                  <div className="banner">
                    <h3>Guest mode doesn’t save</h3>
                    <p>Create an account to save accounts and settings.</p>
                    <div className="row" style={{ marginTop: 10 }}>
                      <button className="btn primary" onClick={() => signOut()}>
                        Create account
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Modals */}
        <Modal open={editorOpen} title={editId ? "Edit account" : "Add account"} onClose={() => setEditorOpen(false)}>
          <div className="formgrid">
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Type</div>
              <select className="select" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as any })}>
                <option value="credit_card">Credit card</option>
                <option value="loan">Loan</option>
              </select>
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Account name</div>
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Capital One / Car Loan / etc." />
            </div>
          </div>

          <div className="formgrid" style={{ marginTop: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>APR (%)</div>
              <input className="input" value={form.apr} onChange={(e) => setForm({ ...form, apr: e.target.value })} inputMode="decimal" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Balance</div>
              <input className="input" value={form.balance} onChange={(e) => setForm({ ...form, balance: e.target.value })} inputMode="decimal" />
            </div>
          </div>

          <div className="formgrid" style={{ marginTop: 10 }}>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Minimum payment (monthly)</div>
              <input className="input" value={form.minPayment} onChange={(e) => setForm({ ...form, minPayment: e.target.value })} inputMode="decimal" />
            </div>
            <div>
              <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>Next due date (day 1–31)</div>
              <select className="select" value={form.nextDueDay} onChange={(e) => setForm({ ...form, nextDueDay: e.target.value })}>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={String(d)}>{d}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <div className="muted" style={{ fontSize: 12, fontWeight: 800, marginBottom: 6 }}>
              Credit limit (optional) {form.type === "loan" ? "(usually leave blank)" : ""}
            </div>
            <input className="input" value={form.creditLimit} onChange={(e) => setForm({ ...form, creditLimit: e.target.value })} inputMode="decimal" />
            <div className="muted" style={{ fontWeight: 900, marginTop: 6 }}>
              Clear Path Payoff works better with a limit. You can continue without it — you can edit this later.
            </div>
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={saveAccount}>{editId ? "Save changes" : "Add account"}</button>
            <button className="btn" onClick={() => setEditorOpen(false)}>Cancel</button>
          </div>
        </Modal>

        <Modal open={lockedOpen} title="Unlock Account Insights" onClose={() => setLockedOpen(false)}>
          <div style={{ fontWeight: 900 }}>
            Pro lets you click into each account and see the month-by-month snowball effect:
          </div>
          <ul style={{ marginTop: 10, paddingLeft: 18, fontWeight: 900 }}>
            <li>Interest added each month (red +)</li>
            <li>Minimum payment impact (green -)</li>
            <li>Balance trajectory and utilization</li>
          </ul>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => { setLockedOpen(false); setTab("plan"); }}>
              Explore Pro
            </button>
            <button className="btn" onClick={() => setLockedOpen(false)}>
              Close
            </button>
          </div>
        </Modal>
      </div>

      {showAds && <AdBanner variant={adVariant} onUpgrade={() => setTab("plan")} />}

      <GlobalStyles />
    </>
  );
}

function StatCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="card" style={{ padding: 12 }}>
      <div className="muted" style={{ fontWeight: 900, fontSize: 12 }}>{title}</div>
      <div style={{ fontWeight: 900, fontSize: 18 }}>{value}</div>
    </div>
  );
}
function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="row" style={{ marginTop: 8 }}>
      <div className="muted" style={{ fontWeight: 900 }}>{label}</div>
      <div style={{ fontWeight: 900 }}>{value}</div>
    </div>
  );
}

function BackgroundArt() {
  return (
    <div className="bg-art" aria-hidden="true">
      <div className="blob a" />
      <div className="blob b" />
      <div className="blob c" />
      <div className="blob d" />
    </div>
  );
}

function GlobalStyles() {
  return (
    <style jsx global>{`
      :root{
        --bg: #cbd4c4;
        --bg2:#e8efe2;
        --card:#f7faf5;
        --text:#0f1b12;
        --muted:#3a4a3f;
        --border: rgba(20,40,26,0.15);
        --shadow: 0 12px 30px rgba(12, 20, 14, 0.12);
        --accent:#2f6f4e;
        --accent2:#7dbb95;
        --good:#166534;
        --bad:#b91c1c;
        --banner:#d9ffea;
        --bannerText:#0a3b23;
      }
      *{ box-sizing:border-box; }
      html,body{ height:100%; }
      body{
        margin:0;
        font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial, "Apple Color Emoji","Segoe UI Emoji";
        color:var(--text);
        background: radial-gradient(1200px 800px at 15% 10%, var(--bg2), var(--bg));
      }
      .bg-art{
        position:fixed;
        inset:0;
        pointer-events:none;
        opacity:0.55;
        z-index:0;
      }
      .blob{
        position:absolute;
        filter: blur(2px);
        border-radius: 999px;
        mix-blend-mode: multiply;
      }
      .blob.a{ width:520px; height:280px; left:-120px; top:120px; background: rgba(255, 169, 169, 0.23); transform: rotate(10deg); }
      .blob.b{ width:560px; height:320px; right:-160px; top:220px; background: rgba(153, 210, 255, 0.22); transform: rotate(-8deg); }
      .blob.c{ width:620px; height:360px; left:120px; bottom:-160px; background: rgba(190, 255, 199, 0.18); transform: rotate(4deg); }
      .blob.d{ width:420px; height:240px; right:120px; bottom:80px; background: rgba(255, 226, 153, 0.18); transform: rotate(-6deg); }

      .app{
        position:relative;
        z-index:1;
        max-width: 1100px;
        margin: 0 auto;
        padding: 18px 14px 92px;
      }
      .topbar{
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
        padding: 14px 14px;
        border: 1px solid var(--border);
        background: rgba(247, 250, 245, 0.72);
        backdrop-filter: blur(6px);
        border-radius: 18px;
        box-shadow: var(--shadow);
      }
      .brand{
        display:flex;
        align-items:center;
        gap:10px;
        min-width: 240px;
      }
      .brand-name{
        font-weight: 800;
        letter-spacing: 0.2px;
        font-size: 18px;
        line-height:1;
      }
      .brand-sub{
        font-size: 12px;
        color: var(--muted);
        margin-top: 2px;
        font-weight: 800;
      }
      .tabs{
        display:flex;
        gap:8px;
        flex-wrap:wrap;
        justify-content:flex-end;
        align-items:center;
      }
      .tab{
        border:1px solid var(--border);
        background: rgba(255,255,255,0.55);
        color: var(--text);
        padding: 9px 12px;
        border-radius: 999px;
        cursor:pointer;
        font-weight: 900;
      }
      .tab.active{
        background: rgba(47,111,78,0.12);
        border-color: rgba(47,111,78,0.35);
      }
      .badge{
        font-size: 12px;
        font-weight: 900;
        padding: 6px 10px;
        border-radius: 999px;
        border:1px solid var(--border);
        background: rgba(255,255,255,0.6);
      }
      .badge.pro{
        border-color: rgba(47,111,78,0.45);
        background: rgba(125,187,149,0.25);
      }
      .grid{
        display:grid;
        grid-template-columns: 1.25fr 0.75fr;
        gap: 14px;
        margin-top: 14px;
      }
      @media (max-width: 980px){
        .grid{ grid-template-columns: 1fr; }
      }
      .card{
        border:1px solid var(--border);
        border-radius: 18px;
        background: rgba(247, 250, 245, 0.82);
        backdrop-filter: blur(6px);
        box-shadow: var(--shadow);
        padding: 14px;
      }
      .card h2{
        margin:0 0 10px;
        font-size: 16px;
        font-weight: 900;
      }
      .muted{ color: var(--muted); font-weight: 800; }
      .row{
        display:flex;
        gap:10px;
        align-items:center;
        justify-content:space-between;
        flex-wrap:wrap;
      }
      .btn{
        border:1px solid var(--border);
        background: rgba(255,255,255,0.65);
        padding: 10px 12px;
        border-radius: 12px;
        cursor:pointer;
        font-weight: 900;
      }
      .btn.primary{
        border-color: rgba(47,111,78,0.55);
        background: rgba(47,111,78,0.12);
      }
      .btn.danger{
        border-color: rgba(185,28,28,0.35);
        background: rgba(185,28,28,0.10);
      }
      .btn:disabled{
        opacity:0.55;
        cursor:not-allowed;
      }
      .input, .select{
        width:100%;
        padding: 11px 12px;
        border-radius: 12px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.7);
        outline: none;
        font-weight: 900;
      }
      .input:focus, .select:focus{
        border-color: rgba(47,111,78,0.45);
        box-shadow: 0 0 0 4px rgba(125,187,149,0.18);
      }
      .formgrid{
        display:grid;
        grid-template-columns: 1fr 1fr;
        gap:10px;
      }
      @media (max-width: 700px){
        .formgrid{ grid-template-columns: 1fr; }
      }
      .hr{
        height:1px;
        background: var(--border);
        margin: 12px 0;
      }
      .banner{
        border-radius: 18px;
        border: 1px solid rgba(47,111,78,0.28);
        background: linear-gradient(90deg, var(--banner), rgba(125,187,149,0.22));
        padding: 16px;
        box-shadow: 0 10px 26px rgba(47,111,78,0.15);
      }
      .banner h3{
        margin:0 0 6px;
        font-size: 16px;
        color: var(--bannerText);
        font-weight: 900;
      }
      .banner p{ margin:0; color: rgba(10,59,35,0.82); font-weight: 900; }
      .toast{
        margin-top:10px;
        padding: 10px 12px;
        border-radius: 12px;
        border:1px solid var(--border);
        background: rgba(255,255,255,0.72);
        font-weight: 900;
      }
      .toast.good{ border-color: rgba(22,101,52,0.35); color: var(--good); }
      .toast.bad{ border-color: rgba(185,28,28,0.35); color: var(--bad); }
      .table{
        width:100%;
        border-collapse: collapse;
        overflow:hidden;
        border-radius: 14px;
        border: 1px solid var(--border);
        background: rgba(255,255,255,0.6);
      }
      .table th,.table td{
        padding: 10px 10px;
        border-bottom:1px solid var(--border);
        text-align:left;
        font-size: 13px;
        font-weight: 900;
      }
      .table th{
        font-size: 12px;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        color: var(--muted);
      }
      .plus{ color: var(--bad); font-weight: 900; }
      .minus{ color: var(--good); font-weight: 900; }
      .adDock{
        position:fixed;
        left:0; right:0; bottom:0;
        z-index: 5;
        display:flex;
        justify-content:center;
        padding: 10px;
        pointer-events:none;
      }
      .ad{
        pointer-events:auto;
        width:min(1100px, 98vw);
        border-radius: 16px;
        border:1px solid var(--border);
        background: rgba(255,255,255,0.78);
        backdrop-filter: blur(6px);
        box-shadow: var(--shadow);
        padding: 12px 14px;
        display:flex;
        align-items:center;
        justify-content:space-between;
        gap:12px;
      }
      .ad.compact{
        padding: 8px 12px;
        opacity:0.92;
      }
      .ad .tag{
        font-size: 11px;
        font-weight: 900;
        letter-spacing: 0.4px;
        color: var(--muted);
      }
      .ad .copy{
        font-weight: 900;
      }
      .smallLink{
        border:none;
        background:transparent;
        color: rgba(47,111,78,0.95);
        font-weight: 900;
        cursor:pointer;
        text-decoration: underline;
      }
      .modalOverlay{
        position:fixed; inset:0;
        background: rgba(0,0,0,0.25);
        display:flex; align-items:center; justify-content:center;
        padding: 16px;
        z-index: 10;
      }
      .modal{
        width:min(680px, 98vw);
        border-radius: 18px;
        border:1px solid var(--border);
        background: rgba(247,250,245,0.92);
        backdrop-filter: blur(8px);
        box-shadow: 0 18px 50px rgba(0,0,0,0.18);
        padding: 14px;
      }
    `}</style>
  );
}
