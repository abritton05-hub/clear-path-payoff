import React from "react";

type GoalOption = {
  id: string;
  label: string;
  icon: string;
};

type GoalsModalProps = {
  open: boolean;
  selected: string[];
  onToggle: (id: string) => void;
  onClose: () => void;
  onNext: () => void;
};

const GOALS: GoalOption[] = [
  { id: "Pay off credit card debt faster", label: "Pay off credit card debt faster", icon: "💳" },
  { id: "Lower my credit utilization", label: "Lower my credit utilization", icon: "📉" },
  { id: "Raise my credit score", label: "Raise my credit score", icon: "📈" },
  { id: "Stop missing payments / stay organized", label: "Stop missing payments / stay organized", icon: "✅" },
  { id: "Build an emergency fund", label: "Build an emergency fund", icon: "🛟" },
  { id: "Qualify for a car loan", label: "Qualify for a car loan", icon: "🚗" },
  { id: "Qualify for a mortgage or refinance", label: "Qualify for a mortgage or refinance", icon: "🏠" },
];

export default function GoalsModal({ open, selected, onToggle, onClose, onNext }: GoalsModalProps) {
  if (!open) return null;

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 999, background: "rgba(8,12,10,0.55)", display: "grid", placeItems: "center", padding: 16 }}>
      <div style={{ width: "min(620px, 96vw)", background: "white", borderRadius: 20, padding: 20, border: "1px solid rgba(0,0,0,0.12)", boxShadow: "0 20px 60px rgba(0,0,0,0.25)", display: "grid", gap: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 1000, fontSize: 18 }}>Choose your goals</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontWeight: 700, color: "rgba(15,27,18,0.7)" }}>
            Close
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          {GOALS.map((goal) => {
            const isSelected = selected.includes(goal.id);
            return (
              <button
                key={goal.id}
                type="button"
                onClick={() => onToggle(goal.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  borderRadius: 14,
                  padding: "12px 12px",
                  border: isSelected ? "2px solid rgba(37,99,235,0.7)" : "1px solid rgba(0,0,0,0.12)",
                  background: isSelected ? "rgba(219,234,254,0.6)" : "rgba(255,255,255,0.9)",
                  fontWeight: 900,
                  textAlign: "left",
                  cursor: "pointer",
                }}
              >
                <span style={{ fontSize: 18 }}>{goal.icon}</span>
                <span style={{ fontSize: 13 }}>{goal.label}</span>
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
          <div style={{ fontWeight: 900 }}>Selected: {selected.length}</div>
          <div style={{ display: "flex", gap: 10 }}>
            <button
              type="button"
              onClick={onClose}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.12)",
                background: "rgba(255,255,255,0.6)",
                fontWeight: 900,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onNext}
              disabled={selected.length === 0}
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(0,0,0,0.12)",
                background: selected.length === 0 ? "rgba(203,213,225,0.6)" : "rgba(59,130,246,0.2)",
                fontWeight: 900,
                cursor: selected.length === 0 ? "not-allowed" : "pointer",
              }}
            >
              Next
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
