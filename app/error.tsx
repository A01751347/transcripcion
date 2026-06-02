"use client";
import { useEffect } from "react";
import { AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4 max-w-md">
        <div className="mx-auto rounded-full bg-destructive/10 p-3 w-fit">
          <AlertCircle className="h-8 w-8 text-destructive" />
        </div>
        <h2 className="text-2xl font-semibold">Algo salió mal</h2>
        <p className="text-sm text-muted-foreground">
          {error.message ?? "Error inesperado en la aplicación."}
        </p>
        <Button onClick={reset} variant="gradient">
          Reintentar
        </Button>
      </div>
    </div>
  );
}
