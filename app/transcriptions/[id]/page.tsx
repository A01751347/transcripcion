import { TranscriptionDetail } from "@/components/transcription-detail";

export default async function TranscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="animate-fade-in">
      <TranscriptionDetail id={id} />
    </div>
  );
}
