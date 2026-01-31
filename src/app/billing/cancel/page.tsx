export default function BillingCancelPage() {
  return (
    <main style={{ padding: "40px 16px", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 12 }}>Checkout canceled</h1>
      <p style={{ fontSize: 16, marginBottom: 16 }}>
        Your payment was canceled. You can try again anytime.
      </p>
      <a href="/" style={{ fontWeight: 700, color: "#1d4ed8" }}>
        Back to dashboard
      </a>
    </main>
  );
}
