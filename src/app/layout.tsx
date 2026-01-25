import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Clear Path Payoff",
  description: "Discipline scoreboard — simple moves, massive results.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
