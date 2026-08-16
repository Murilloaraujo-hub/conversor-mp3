import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "🎵 Video2MP3 — Converta vídeos em MP3",
  description: "Cole o link do vídeo e transforme o áudio em MP3. Suporta YouTube, links diretos e muito mais.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
