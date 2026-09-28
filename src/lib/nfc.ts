// 변경: SUN URL(e, c) 파싱과 고정 URL(/t/{token}) 파싱. NFC URL 쓰기는 없다. 서버·클라이언트 공용 (브라우저 API 는 호출 시점에만 사용)

export interface SunParams {
  e: string;
  c: string;
}

const E_PATTERN = /^[0-9A-Fa-f]{32}$/;
const C_PATTERN = /^[0-9A-Fa-f]{16}$/;

// 기능: 태그 URL 또는 쿼리 문자열에서 SUN 파라미터를 꺼낸다. 형식이 맞지 않으면 null
export function parseSunUrl(raw: string): SunParams | null {
  let params: URLSearchParams;
  try {
    const text = raw.trim();
    params = /^[a-z]+:\/\//i.test(text)
      ? new URL(text).searchParams
      : new URLSearchParams(text.slice(text.indexOf("?") + 1));
  } catch {
    return null;
  }
  return toSunParams(params.get("e"), params.get("c"));
}

// 기능: e, c 값 형식 확인 (32자리 / 16자리 hex)
export function toSunParams(e: unknown, c: unknown): SunParams | null {
  if (typeof e !== "string" || typeof c !== "string") return null;
  if (!E_PATTERN.test(e) || !C_PATTERN.test(c)) return null;
  return { e, c };
}

export interface StaticTagParams {
  token: string;
}

// 지점 토큰 형식 (createTagToken: 소문자·숫자 10자)
export const STATIC_TOKEN_PATTERN = /^[0-9a-z]{10}$/i;
const STATIC_PATH = /^\/t\/([0-9a-z]{10})\/?$/i;

// 기능: 고정 URL(<origin>/t/{token}) 에서 토큰을 꺼낸다. SUN 파라미터가 있거나 형식이 다르면 null (호스트는 SUN 과 같이 보지 않음)
export function parseStaticTagUrl(raw: string): StaticTagParams | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parseSunUrl(url.href)) return null;
  const match = STATIC_PATH.exec(url.pathname);
  return match ? { token: match[1].toLowerCase() } : null;
}

// 기능: 보관된 고정 토큰 값 형식 확인
export function toStaticParams(token: unknown): StaticTagParams | null {
  if (typeof token !== "string" || !STATIC_TOKEN_PATTERN.test(token)) return null;
  return { token: token.toLowerCase() };
}

export function isWebNfcAvailable() {
  return typeof window !== "undefined" && "NDEFReader" in window;
}

// 변경: 시리얼 번호(UID)는 쓰지 않고 첫 번째로 읽히는 URL/텍스트 레코드만 반환한다
export async function scanNfcOnce(): Promise<{ url?: string }> {
  if (!isWebNfcAvailable()) {
    throw new Error("이 브라우저는 NFC를 지원하지 않습니다.");
  }
  const NDEFReader = (
    window as unknown as {
      NDEFReader: new () => {
        scan: () => Promise<void>;
        onreading: ((event: NfcReadingEvent) => void) | null;
        onreadingerror: (() => void) | null;
      };
    }
  ).NDEFReader;
  const reader = new NDEFReader();
  await reader.scan();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("NFC 대기 시간이 초과되었습니다.")), 25000);
    reader.onreadingerror = () => {
      clearTimeout(timer);
      reject(new Error("NFC 태그를 읽지 못했습니다."));
    };
    reader.onreading = (event) => {
      clearTimeout(timer);
      let url: string | undefined;
      for (const record of event.message.records) {
        if (url) break;
        try {
          const decoder = new TextDecoder(record.encoding ?? "utf-8");
          const text = decoder.decode(record.data);
          if (text) url = text;
        } catch {
          // ignore undecodable records
        }
      }
      resolve({ url });
    };
  });
}

interface NfcReadingEvent {
  message: {
    records: Array<{
      recordType: string;
      encoding?: string;
      data: BufferSource;
    }>;
  };
}
