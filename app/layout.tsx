import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";
import { MobileNav } from "@/components/mobile-nav";

export const metadata: Metadata = {
  title: "Transcripto · Tus audios, texto y ideas",
  description:
    "Transcribe audios en español (y con palabras en inglés) con Whisper, resume, extrae ideas clave y conversa con tus grabaciones.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className="h-full">
      <body className="h-full antialiased font-sans">
        <Providers>
          <div className="flex h-full min-h-screen bg-gradient-to-br from-background via-background to-primary/5">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <MobileNav />
              <main className="flex-1 overflow-y-auto scrollbar-thin">
                <div className="container max-w-7xl mx-auto py-6 px-4 pb-24 lg:pb-6">
                  {children}
                </div>
              </main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
