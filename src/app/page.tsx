import { JoinForm } from "@/components/join-form";

export default function HomePage() {
  return (
    <main className="min-h-screen bg-paper text-ink">
      <div className="mx-auto grid min-h-screen max-w-5xl gap-10 px-6 py-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <section>
          <p className="text-xs font-semibold tracking-[0.22em] text-moss">NFC WALKING RACE</p>
          <h1 className="font-display mt-3 text-6xl leading-[0.95] sm:text-8xl">
            CHECK
            <br />
            POINT
          </h1>
          <p className="mt-5 max-w-md text-base leading-7 text-ink/65">
            걸어서 정해진 지점마다 NFC를 찍고, 팀으로 완주하세요. 우리 팀의 레이스만 보입니다.
            순위는 시상식에서 공개됩니다.
          </p>
        </section>
        <section className="rounded-[32px] border border-ink/10 bg-white p-6 shadow-sm">
          <h2 className="font-display text-3xl">참가하기</h2>
          <p className="mt-1 text-sm text-ink/50">세션 코드를 입력하거나, 초대 QR을 스캔하세요.</p>
          <div className="mt-6">
            <JoinForm />
          </div>
        </section>
      </div>
    </main>
  );
}
