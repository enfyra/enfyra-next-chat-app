import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Enfyra Next Chat",
  description: "A Next.js chat app powered by Enfyra auth, REST, and realtime WebSocket.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
