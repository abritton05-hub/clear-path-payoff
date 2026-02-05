export default function BillingSuccessPage() {
  return (
    <main style={{ padding: "40px 16px", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>Payment successful</h1>
      <p style={{ fontSize: 16, marginBottom: 16 }}>
        Thanks for upgrading! Your Pro access should unlock shortly.
      </p>
      <a href="/" style={{ fontWeight: 700, color: "#1d4ed8" }}>
        Back to dashboard
      </a>
    </main>
  );
}
