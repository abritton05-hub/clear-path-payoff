"use client";

import React, { useEffect, useMemo, useState } from "react";

type Goal = {
  id: string;
  title: string;
  description?: string;
  icon: React.ReactNode;
};

type GoalsModalProps = {
  open: boolean;
  onClose: () => void;
  onNext: (selectedGoalIds: string[]) => void;
  goals?: Goal[];
  maxSelect?: number;
  subtitle?: string;
};

function IconHouse() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5 9.5V21h14V9.5" />
      <path d="M9 21v-6h6v6" />
    </svg>
  );
}

function IconRing() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Z" />
      <path d="M12 2v3" />
      <path d="M10 3h4" />
    </svg>
  );
}

function IconCard() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="6" width="18" height="12" rx="2" />
      <path d="M3 10h18" />
      <path d="M7 15h4" />
    </svg>
  );
}

function IconChart() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 19V5" />
      <path d="M4 19h16" />
      <path d="M8 15v-4" />
      <path d="M12 15v-7" />
      <path d="M16 15v-2" />
    </svg>
  );
}

function IconPiggy() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M5 13c0-4 3-7 7-7h2c4 0 7 3 7 7v2a3 3 0 0 1-3 3h-1l-2 2H10l-2-2H7a3 3 0 0 1-3-3v-2Z" />
      <path d="M8 10h.01" />
      <path d="M19 10h2" />
      <path d="M3 12h2" />
    </svg>
  );
}

const defaultGoals: Goal[] = [
  { id: "buy-house", title: "Buy a house", description: "Plan and save for a down payment", icon: <IconHouse /> },
  { id: "get-married", title: "Get married", description: "Build a wedding fund without stress", icon: <IconRing /> },
  { id: "payoff-debt", title: "Pay off debt", description: "Attack balances and cut interest", icon: <IconCard /> },
  { id: "build-credit", title: "Build credit", description: "Utilization + on-time habits", icon: <IconChart /> },
  { id: "save-money", title: "Save money", description: "Build a buffer and future goals", icon: <IconPiggy /> },
  { id: "stay-consistent", title: "Stay consistent", description: "Simple plan you can follow", icon: <IconChart /> },
];

export default function GoalsModal({
  open,
  onClose,
  onNext,
  goals = defaultGoals,
  maxSelect,
  subtitle = "Easy now for an Easier Tomorrow",
}: GoalsModalProps) {
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (!open) setSelected([]);
  }, [open]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const toggle = (id: string) => {
    const isOn = selectedSet.has(id);
    if (isOn) return setSelected((prev) => prev.filter((x) => x !== id));
    if (maxSelect && selected.length >= maxSelect) return;
    setSelected((prev) => [...prev, id]);
  };

  const canNext = selected.length > 0;

  return (
    <div className="fixed inset-0 z-50">
      <button aria-label="Close modal" onClick={onClose} className="absolute inset-0 bg-black/50" />

      <div className="relative mx-auto mt-10 w-[min(920px,92vw)] overflow-hidden rounded-2xl bg-white shadow-2xl">
        <div className="px-6 py-5 border-b">
          <h2 className="text-2xl font-semibold tracking-tight">Set your goals</h2>
          <div className="mt-1 text-sm text-black/60">{subtitle}</div>
        </div>

        <div className="p-6">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {goals.map((g) => {
              const active = selectedSet.has(g.id);
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => toggle(g.id)}
                  className={[
                    "group text-left rounded-xl border p-4 transition",
                    "focus:outline-none focus:ring-2 focus:ring-blue-400/40",
                    active ? "border-blue-500 bg-blue-50" : "border-black/10 hover:border-black/25",
                  ].join(" ")}
                >
                  <div className="flex items-start gap-3">
                    <div className="mt-0.5 shrink-0 text-blue-600">{g.icon}</div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-semibold">{g.title}</div>
                        <div
                          className={[
                            "mt-0.5 h-5 w-5 shrink-0 rounded border flex items-center justify-center",
                            active ? "border-blue-600 bg-blue-600 text-white" : "border-black/20 bg-white",
                          ].join(" ")}
                          aria-hidden
                        >
                          {active ? <span className="text-xs leading-none">✓</span> : null}
                        </div>
                      </div>
                      {g.description ? (
                        <div className="mt-1 text-sm text-black/60">{g.description}</div>
                      ) : null}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t px-6 py-4">
          <div className="min-w-0">
            <div className="text-sm text-black/60">Selected</div>
            <div className="mt-1 flex flex-wrap gap-2">
              {selected.length === 0 ? (
                <span className="text-sm text-black/40">None</span>
              ) : (
                selected.map((id) => {
                  const goal = goals.find((x) => x.id === id);
                  return (
                    <span
                      key={id}
                      className="rounded-full border border-black/10 bg-black/[0.04] px-3 py-1 text-sm"
                    >
                      {goal?.title ?? id}
                    </span>
                  );
                })
              )}
            </div>
          </div>

          <button
            disabled={!canNext}
            onClick={() => onNext(selected)}
            className={[
              "shrink-0 rounded-xl px-5 py-3 text-sm font-semibold transition",
              canNext ? "bg-black text-white hover:bg-black/90" : "bg-black/10 text-black/40 cursor-not-allowed",
            ].join(" ")}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
