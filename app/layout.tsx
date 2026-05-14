import type { Metadata, Viewport } from "next";
import { MantineProvider, createTheme } from "@mantine/core";
import "@mantine/core/styles.css";
import "./styles.css";

export const metadata: Metadata = {
  title: "Enfyra Next Chat",
  description: "A Next.js chat app powered by Enfyra auth, REST, and realtime WebSocket.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

const theme = createTheme({
  primaryColor: "blue",
  defaultRadius: "md",
  fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
});

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <MantineProvider defaultColorScheme="dark" theme={theme}>
          {children}
        </MantineProvider>
      </body>
    </html>
  );
}
