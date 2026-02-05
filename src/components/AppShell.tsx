"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import React from "react";

type NavItem = { href: string; label: string; emoji: string };

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", emoji: "🏠" },
  { href: "/accounts", label: "Accounts", emoji: "💳" },
  { href: "/plan", label: "Plan", emoji: "📅" },
  { href: "/goals", label: "Goals", emoji: "🎯" },
  { href: "/settings", label: "Settings", emoji: "⚙️" },
];

function cls(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="app-root">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">CP</div>
          <div className="brand-text">
            <div className="brand-name">Clear Path Payoff</div>
            <div className="brand-sub">Discipline scoreboard</div>
          </div>
        </div>

        <nav className="nav">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cls("nav-item", active && "nav-item-active")}
              >
                <span className="nav-emoji" aria-hidden="true">
                  {item.emoji}
                </span>
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="pill">Pro tip: keep it simple</div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-left">
            <div className="topbar-title">Clear Path Payoff</div>
            <div className="topbar-sub">Your numbers. Your rules.</div>
          </div>

          <div className="topbar-actions">
            <Link className="btn btn-ghost" href="/accounts">
              + Add Account
            </Link>
            <Link className="btn btn-primary" href="/plan">
              Run Plan
            </Link>
          </div>
        </header>

        <main className="content">{children}</main>

        <nav className="bottomnav" aria-label="Primary">
          {NAV.map((item) => {
            const active =
              pathname === item.href ||
              (item.href !== "/" && pathname?.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cls("bottomnav-item", active && "bottomnav-item-active")}
              >
                <span className="bottomnav-emoji" aria-hidden="true">
                  {item.emoji}
                </span>
                <span className="bottomnav-label">{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}
