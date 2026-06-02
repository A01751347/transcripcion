"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  AudioLines,
  Folder,
  Home,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const FOLDER_COLORS = [
  "#a855f7",
  "#ec4899",
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#14b8a6",
  "#6366f1",
];

export function Sidebar() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [color, setColor] = useState(FOLDER_COLORS[0]);

  const { data } = useQuery({
    queryKey: ["folders"],
    queryFn: async () => {
      const res = await fetch("/api/folders");
      return res.json();
    },
  });

  const createFolder = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/folders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, color }),
      });
      if (!res.ok) throw new Error("Error creando carpeta");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Carpeta creada");
      queryClient.invalidateQueries({ queryKey: ["folders"] });
      setOpen(false);
      setName("");
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const folders = data?.folders ?? [];

  const navItems = [
    { href: "/", label: "Inicio", icon: Home },
    { href: "/transcriptions", label: "Transcripciones", icon: AudioLines },
    { href: "/upload", label: "Subir audio", icon: Upload },
  ];

  return (
    <aside className="hidden lg:flex w-64 flex-col border-r bg-card/50 backdrop-blur-sm">
      <div className="p-6">
        <Link href="/" className="flex items-center gap-2">
          <div className="rounded-lg bg-gradient-to-br from-violet-500 to-fuchsia-500 p-2">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <div className="font-bold text-lg leading-tight">Transcripto</div>
            <div className="text-xs text-muted-foreground">
              Audio → texto → ideas
            </div>
          </div>
        </Link>
      </div>

      <nav className="flex-1 px-3 space-y-1 overflow-y-auto scrollbar-thin">
        <div className="space-y-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors",
                  isActive
                    ? "bg-primary/10 text-primary font-medium"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </div>

        <div className="pt-6 pb-2 px-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            Carpetas
          </span>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Nueva carpeta</DialogTitle>
                <DialogDescription>
                  Organiza tus transcripciones por proyecto, tema o cliente.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="folder-name">Nombre</Label>
                  <Input
                    id="folder-name"
                    placeholder="Ej. Reuniones de equipo"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Color</Label>
                  <div className="flex gap-2">
                    {FOLDER_COLORS.map((c) => (
                      <button
                        key={c}
                        type="button"
                        onClick={() => setColor(c)}
                        className={cn(
                          "h-7 w-7 rounded-full border-2 transition-transform",
                          color === c
                            ? "border-foreground scale-110"
                            : "border-transparent"
                        )}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => createFolder.mutate()}
                  disabled={!name.trim() || createFolder.isPending}
                  variant="gradient"
                >
                  Crear
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        <div className="space-y-0.5">
          {folders.map((f: any) => {
            const href = `/transcriptions?folderId=${f.id}`;
            return (
              <Link
                key={f.id}
                href={href}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
              >
                <Folder
                  className="h-4 w-4"
                  style={{ color: f.color ?? undefined }}
                  fill={f.color ?? "none"}
                  fillOpacity={0.2}
                />
                <span className="flex-1 truncate">{f.name}</span>
                <span className="text-xs">{f._count.transcriptions}</span>
              </Link>
            );
          })}
          {folders.length === 0 && (
            <p className="text-xs text-muted-foreground px-3 py-2">
              Aún no tienes carpetas
            </p>
          )}
        </div>
      </nav>

      <div className="p-3 border-t">
        <Link href="/upload" className="block">
          <Button variant="gradient" className="w-full" size="lg">
            <Upload className="h-4 w-4 mr-2" />
            Subir audio
          </Button>
        </Link>
      </div>
    </aside>
  );
}
