import { Lobby } from "@/components/lobby";

export const dynamic = "force-dynamic";

export default async function RoomPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return <Lobby code={code.toUpperCase()} />;
}
