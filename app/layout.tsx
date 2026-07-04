import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "Context Handoff Generator",
  description:
    "Generate a clean Markdown handoff from one or more ChatGPT shared links.",
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
