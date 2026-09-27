import { AdminSessionView } from "./ui";

export default async function AdminSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <AdminSessionView sessionId={id} />;
}
