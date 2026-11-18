import type { Metadata } from "next";
import { SlidesComposer } from "@/components/slides-composer";

export const metadata: Metadata = {
  title: "Slides en mosaico · Transcripto",
  description:
    "Convierte PDFs de presentaciones en imágenes de 4 o 9 slides para mandarlas a un LLM con visión gastando menos tokens.",
};

export default function SlidesPage() {
  return <SlidesComposer />;
}
