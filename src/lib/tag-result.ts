import type { TeamRaceView } from "./types";

// 기능: 태깅 성공 응답과 /t → /race 로 넘기는 성공 안내(sessionStorage) 공용 처리

export interface TagSuccess {
  view: TeamRaceView;
  tag: { name: string; nextHint: string };
}

export interface TagOverlay {
  title: string;
  body: string;
}

export const PENDING_TAG_KEY = "pendingTag";
const TAG_FLASH_KEY = "tagFlash";

export function overlayFor(result: TagSuccess): TagOverlay {
  if (result.view.finished) {
    return { title: "완주!", body: "기록이 확정되었습니다. 시상식 안내를 기다려 주세요." };
  }
  return {
    title: `${result.tag.name} 태깅 완료`,
    body:
      result.tag.nextHint ||
      (result.view.nextTag ? `다음 목적지: ${result.view.nextTag.name}` : "다음 지점으로 이동하세요."),
  };
}

export function saveTagFlash(overlay: TagOverlay) {
  sessionStorage.setItem(TAG_FLASH_KEY, JSON.stringify(overlay));
}

// 기능: 저장된 성공 안내를 한 번만 꺼낸다 (읽으면 바로 삭제)
export function takeTagFlash(): TagOverlay | null {
  const raw = sessionStorage.getItem(TAG_FLASH_KEY);
  if (!raw) return null;
  sessionStorage.removeItem(TAG_FLASH_KEY);
  try {
    const value = JSON.parse(raw) as TagOverlay;
    return typeof value?.title === "string" && typeof value?.body === "string" ? value : null;
  } catch {
    return null;
  }
}
