import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Datadog Presales Practice Simulator",
  description: "Interactive simulator for Datadog DPN presales engineers.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
