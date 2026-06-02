import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="text-center space-y-4">
        <div className="text-7xl gradient-text font-bold">404</div>
        <h2 className="text-2xl font-semibold">Página no encontrada</h2>
        <p className="text-muted-foreground">
          La transcripción o ruta que buscas no existe.
        </p>
        <Link href="/">
          <Button variant="gradient">Volver al inicio</Button>
        </Link>
      </div>
    </div>
  );
}
