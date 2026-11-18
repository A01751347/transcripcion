"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AudioLines, Home, LayoutGrid, Sparkles, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Inicio", icon: Home },
    { href: "/transcriptions", label: "Audios", icon: AudioLines },
    { href: "/upload", label: "Subir", icon: Upload },
    { href: "/slides", label: "Slides", icon: LayoutGrid },
  ];

  return (
    <>
      <header className="lg:hidden flex items-center justify-between p-4 border-b bg-card/50 backdrop-blur-sm sticky top-0 z-30">
        <Link href="/" className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 p-1.5">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <span className="font-bold">Transcripto</span>
        </Link>
      </header>
      <nav className="lg:hidden fixed bottom-0 left-0 right-0 border-t bg-background/90 backdrop-blur-md z-30">
        <div className="flex justify-around">
          {items.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex flex-col items-center gap-1 py-2.5 px-4 text-xs transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
                )}
              >
                <Icon className="h-5 w-5" />
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </>
  );
}
