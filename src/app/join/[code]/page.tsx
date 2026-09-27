import { JoinForm } from "@/components/join-form";

export default async function JoinPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  return (
    <main className="min-h-screen bg-paper px-6 py-12 text-ink">
      <div className="mx-auto max-w-md rounded-[32px] bg-white p-6 shadow-sm">
        <p className="text-xs tracking-[0.2em] text-moss">INVITE</p>
        <h1 className="font-display mt-2 text-4xl">세션 참가</h1>
        <p className="mt-2 text-sm text-ink/50">
          코드 <span className="font-semibold tracking-[0.16em]">{code}</span> 세션입니다.
        </p>
        <div className="mt-6">
          <JoinForm initialCode={code} />
        </div>
      </div>
    </main>
  );
}
