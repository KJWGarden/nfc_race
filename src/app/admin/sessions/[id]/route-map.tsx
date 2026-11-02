"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { NfcTag } from "@/lib/types";

// 기능: 세션 경로(출발 → 지점 → 골인)를 파스텔 크레파스로 손그림처럼 그린 노드 순서 지도.
// 좌표는 실제 위치가 아니라 경로 순서대로 지그재그(serpentine)로 배치하는 장식용 배치다.

type RouteMapTag = Pick<NfcTag, "id" | "name">;

type Crayon = { fill: string; stroke: string };

// 기능: 앱 팔레트(lime·gold·moss·terra)를 부드럽게 푼 파스텔 크레파스 상자
const CRAYONS: Crayon[] = [
  { fill: "#f9b49a", stroke: "#e27a5c" }, // peach (terra)
  { fill: "#f7dc84", stroke: "#cfa22e" }, // butter (gold)
  { fill: "#addfb9", stroke: "#5f9f74" }, // mint (moss)
  { fill: "#a6cff0", stroke: "#5b93c6" }, // sky
  { fill: "#cdb9f0", stroke: "#8d70c8" }, // lilac
  { fill: "#f6b2cc", stroke: "#d36f9a" }, // pink
];
const START_CRAYON: Crayon = { fill: "#d6ef84", stroke: "#8fb22c" };
const FINISH_CRAYON: Crayon = { fill: "#ffa784", stroke: "#e2582c" };
const LINE_COLOR = "#7c86a6";
const LINE_SHADOW = "#b9a6cf";
const TEXT_COLOR = "#2f3528";

const CELL_W = 156;
const ROW_H = 138;
const PAD_X = 22;
const PAD_TOP = 34;
const NODE_R = 27;
const END_R = 33;

type Pt = { x: number; y: number };

// 기능: 문자열을 32비트 시드로 (FNV-1a). 같은 지점 id 는 항상 같은 흔들림을 만든다
function hashString(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// 기능: 시드 기반 결정적 난수(mulberry32). 렌더마다 모양이 바뀌지 않게 Math.random 대신 쓴다
function rng(seedText: string) {
  let a = hashString(seedText);
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f = (n: number) => Math.round(n * 10) / 10;

// 기능: 점 목록을 Catmull-Rom 곡선(cubic bezier)으로 이어 손으로 그은 듯한 부드러운 선을 만든다
function smoothPath(points: Pt[], closed = false): string {
  if (points.length < 2) return "";
  const p = points;
  let d = `M${f(p[0].x)},${f(p[0].y)}`;
  for (let i = 0; i < p.length - 1; i++) {
    const p0 = p[i - 1] ?? (closed ? p[p.length - 1] : p[i]);
    const p1 = p[i];
    const p2 = p[i + 1];
    const p3 = p[i + 2] ?? (closed ? p[0] : p2);
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += ` C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(p2.x)},${f(p2.y)}`;
  }
  return d;
}

// 기능: 한 바퀴 조금 넘게 겹쳐 그린 손그림 동그라미 (반지름이 천천히 출렁이고 끝이 살짝 삐져나온다)
function wobblyLoop(cx: number, cy: number, r: number, seed: string, turns = 1.14, amp = 1): string {
  const rand = rng(seed);
  const start = rand() * Math.PI * 2;
  const phaseA = rand() * Math.PI * 2;
  const phaseB = rand() * Math.PI * 2;
  const steps = 22;
  const pts: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const a = start + t * Math.PI * 2 * turns;
    // 변경: 겹쳐 지나가는 끝부분은 반지름을 조금 키워 두 줄이 어긋나 보이게 한다
    const drift = t > 0.85 ? (t - 0.85) * 14 : 0;
    // 변경: amp 로 흔들림 크기를 줄여 작은 미니 노드도 동그랗게 보이게 한다 (전체 지도는 1)
    const rr = r + (Math.sin(a * 2 + phaseA) * 1.6 + Math.sin(a * 3 + phaseB) * 1.1 + drift + (rand() - 0.5) * 1.2) * amp;
    pts.push({ x: cx + Math.cos(a) * rr, y: cy + Math.sin(a) * rr * 0.97 });
  }
  return smoothPath(pts);
}

// 기능: 원 안을 지그재그로 문질러 칠한 크레파스 채색 (한 획으로 이어져 그리기 애니메이션에서 색칠하듯 보인다)
function scribbleFill(cx: number, cy: number, r: number, seed: string, baseDeg = -30, gap = 4.6): string {
  const rand = rng(seed);
  const angle = (baseDeg - rand() * 25) * (Math.PI / 180);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const pts: Pt[] = [];
  let flip = false;
  for (let o = -r + 3; o <= r - 3; o += gap) {
    const half = Math.sqrt(Math.max(0, r * r - o * o)) - 2.5;
    if (half <= 1) continue;
    const a = -half + rand() * 3;
    const b = half - rand() * 3;
    const ends = flip ? [b, a] : [a, b];
    for (const s of ends) {
      // 기능: 회전 좌표계(s 진행, o 간격)를 화면 좌표로 바꾸고 살짝 흔든다
      const jx = (rand() - 0.5) * 1.6;
      const jy = (rand() - 0.5) * 1.6;
      pts.push({ x: cx + s * cos - o * sin + jx, y: cy + s * sin + o * cos + jy });
    }
    flip = !flip;
  }
  if (pts.length < 2) return "";
  // 변경: 지그재그 꺾임은 날카롭게 남겨 문지른 손맛을 살린다 (곡선 보간 없음)
  return pts.map((p, i) => `${i === 0 ? "M" : "L"}${f(p.x)},${f(p.y)}`).join(" ");
}

// 기능: 두 점 사이를 몇 개의 흔들린 중간점으로 이어 손으로 그은 선을 만든다
function wobblyLine(points: Pt[], seed: string, amount: number): { d: string; end: Pt; prev: Pt } {
  const rand = rng(seed);
  const pts = points.map((p, i) =>
    i === 0 || i === points.length - 1
      ? { x: p.x + (rand() - 0.5) * amount * 0.6, y: p.y + (rand() - 0.5) * amount * 0.6 }
      : { x: p.x + (rand() - 0.5) * amount * 2, y: p.y + (rand() - 0.5) * amount * 2 },
  );
  return { d: smoothPath(pts), end: pts[pts.length - 1], prev: pts[pts.length - 2] };
}

// 기능: 선 끝의 손그림 화살촉 (두 갈래 짧은 획)
function arrowHead(end: Pt, prev: Pt, seed: string, size = 10): string {
  const rand = rng(seed);
  const ang = Math.atan2(end.y - prev.y, end.x - prev.x);
  const len = size + rand() * size * 0.2;
  const spread = 0.5 + rand() * 0.12;
  const a1 = ang + Math.PI - spread;
  const a2 = ang + Math.PI + spread + (rand() - 0.5) * 0.15;
  const p1 = { x: end.x + Math.cos(a1) * len, y: end.y + Math.sin(a1) * len };
  const p2 = { x: end.x + Math.cos(a2) * len, y: end.y + Math.sin(a2) * len };
  return `M${f(p1.x)},${f(p1.y)} L${f(end.x)},${f(end.y)} L${f(p2.x)},${f(p2.y)}`;
}

// 기능: 이름이 길면 화면 폭 기준(한글 2칸, 영문 1칸)으로 잘라 말줄임표를 붙인다
function truncateName(name: string, maxUnits = 19): string {
  let units = 0;
  let out = "";
  for (const ch of name) {
    const w = /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
    if (units + w > maxUnits) return `${out.trimEnd()}…`;
    units += w;
    out += ch;
  }
  return out;
}

function textUnits(text: string): number {
  let units = 0;
  for (const ch of text) units += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
  return units;
}

type MapNode = {
  key: string;
  kind: "start" | "checkpoint" | "finish";
  order: number;
  name: string;
  label: string;
  center: Pt;
  r: number;
  crayon: Crayon;
  tilt: number;
};

type MapSegment = { key: string; main: string; over: string; arrow: string };

// 기능: 열 수에 맞춰 노드를 지그재그로 배치하고, 같은 줄은 가로선·줄 바꿈은 바깥쪽 U자 곡선으로 잇는다
function buildLayout(tags: RouteMapTag[], cols: number) {
  const items: { key: string; kind: MapNode["kind"]; name: string }[] = [
    { key: "start", kind: "start", name: "출발" },
    ...tags.map((tag) => ({ key: tag.id, kind: "checkpoint" as const, name: tag.name })),
    { key: "finish", kind: "finish", name: "골인" },
  ];
  const rows = Math.ceil(items.length / cols);
  const width = cols * CELL_W + PAD_X * 2;
  const height = PAD_TOP + rows * ROW_H - 6;

  // 기능: 색은 지점 id 로 정하되, 바로 앞 노드와 같은 색이면 다음 크레파스로 바꿔 이웃끼리 겹치지 않게 한다
  let prevColor = -1;
  const nodes: MapNode[] = items.map((item, k) => {
    const row = Math.floor(k / cols);
    const inRow = k % cols;
    const col = row % 2 === 0 ? inRow : cols - 1 - inRow;
    const rand = rng(`pos:${item.key}`);
    const isEnd = item.kind !== "checkpoint";
    let colorIndex = hashString(item.key) % CRAYONS.length;
    if (colorIndex === prevColor) colorIndex = (colorIndex + 1) % CRAYONS.length;
    prevColor = item.kind === "checkpoint" ? colorIndex : -1;
    const crayon = item.kind === "start" ? START_CRAYON : item.kind === "finish" ? FINISH_CRAYON : CRAYONS[colorIndex];
    return {
      key: item.key,
      kind: item.kind,
      order: k,
      name: item.name,
      label: truncateName(item.name),
      center: {
        x: PAD_X + col * CELL_W + CELL_W / 2 + (rand() - 0.5) * 14,
        y: PAD_TOP + row * ROW_H + 30 + (rand() - 0.5) * 12,
      },
      r: isEnd ? END_R : NODE_R,
      crayon,
      tilt: (rand() - 0.5) * 8,
    };
  });

  const segments: MapSegment[] = [];
  for (let k = 0; k < nodes.length - 1; k++) {
    const a = nodes[k];
    const b = nodes[k + 1];
    const seed = `seg:${a.key}>${b.key}`;
    const sameRow = Math.floor(k / cols) === Math.floor((k + 1) / cols);
    let pts: Pt[];
    if (sameRow) {
      const dir = Math.sign(b.center.x - a.center.x) || 1;
      const x1 = a.center.x + dir * (a.r + 8);
      const x2 = b.center.x - dir * (b.r + 10);
      const y1 = a.center.y;
      const y2 = b.center.y;
      const sag = (rng(seed)() - 0.5) * 14;
      pts = [
        { x: x1, y: y1 },
        { x: x1 + (x2 - x1) * 0.35, y: y1 + (y2 - y1) * 0.35 + sag },
        { x: x1 + (x2 - x1) * 0.7, y: y1 + (y2 - y1) * 0.7 + sag * 0.6 },
        { x: x2, y: y2 },
      ];
    } else {
      // 기능: 줄 끝에서 바깥쪽으로 크게 돌아 아래 줄로 내려가는 U자 곡선 (이름표와 겹치지 않게)
      const side = a.center.x > width / 2 ? 1 : -1;
      const ax = a.center.x + side * (a.r + 7);
      const bx = b.center.x + side * (b.r + 9);
      const bulge = Math.max(ax, bx) * (side > 0 ? 1 : 0) + Math.min(ax, bx) * (side < 0 ? 1 : 0) + side * 36;
      const midY = (a.center.y + b.center.y) / 2;
      pts = [
        { x: ax, y: a.center.y + 4 },
        { x: ax + side * 24, y: a.center.y + 22 },
        { x: bulge, y: midY },
        { x: bx + side * 24, y: b.center.y - 22 },
        { x: bx, y: b.center.y - 4 },
      ];
    }
    const main = wobblyLine(pts, seed, 2.6);
    const over = wobblyLine(pts, `${seed}:over`, 3.4);
    segments.push({ key: seed, main: main.d, over: over.d, arrow: arrowHead(main.end, main.prev, `${seed}:arrow`) });
  }

  return { nodes, segments, width, height };
}

// 기능: 카드 폭에 맞는 열 수 (좁은 화면 2열 ~ 넓은 화면 6열). 글자가 너무 작아지지 않게 viewBox 폭을 함께 바꾼다
function colsForWidth(width: number): number {
  return Math.max(2, Math.min(6, Math.floor(width / CELL_W)));
}

export function RouteMap({ tags }: { tags: RouteMapTag[] }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(4);
  const rawId = useId();
  const uid = rawId.replace(/[^a-zA-Z0-9_-]/g, "");

  // 기능: 카드 폭이 바뀌면 열 수를 다시 계산 (observe 직후 첫 콜백에서 초기값도 맞춘다)
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setCols(colsForWidth(width));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 기능: 전체 지도가 화면 위로 완전히 지나가면 상단 미니 지도를 띄우고, 다시 보이면 숨긴다 (빈 경로면 관찰하지 않음)
  // 변경: 지도 아래(접힌 영역)↔위로 한 번에 건너뛰는 스크롤도 놓치지 않게 IntersectionObserver 대신 스크롤·리사이즈를 rAF 로 묶어 판정한다
  const hasTags = tags.length > 0;
  const [pinned, setPinned] = useState<boolean | null>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !hasTags) return;
    let frame = 0;
    const check = () => {
      frame = 0;
      setPinned(el.getBoundingClientRect().bottom <= 0);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    schedule();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [hasTags]);

  const layout = useMemo(() => buildLayout(tags, cols), [tags, cols]);
  // 기능: 순서가 바뀌면(추가·이동·삭제) SVG 를 새로 마운트해 그리기 애니메이션을 처음부터 다시 재생한다
  const routeKey = tags.map((tag) => tag.id).join("|");

  if (tags.length === 0) {
    return (
      <div ref={wrapRef} data-testid="route-map" className="crayon-paper mt-3 rounded-2xl px-4 py-6 text-center text-xs text-ink/55">
        <p data-testid="route-map-empty">경로에 지점을 추가하면 여기에 순서 지도가 그려집니다.</p>
      </div>
    );
  }

  const { nodes, segments, width, height } = layout;
  // 변경: 노드가 많아도 전체 그리기가 4초 안팎에 끝나도록 한 칸 간격을 줄인다
  const step = Math.min(0.42, Math.max(0.16, 3.8 / nodes.length));
  const filter = `url(#crayon-${uid})`;
  const ariaLabel = `경로 순서: ${nodes.map((n) => (n.kind === "checkpoint" ? `${n.order}. ${n.name}` : n.name)).join(" → ")}`;

  return (
    <>
      <div ref={wrapRef} data-testid="route-map" className="crayon-paper mt-3 overflow-hidden rounded-2xl">
        <svg
          key={routeKey}
          data-testid="route-map-svg"
          viewBox={`0 0 ${width} ${height}`}
          className="block h-auto w-full"
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            {/* 기능: 크레파스 질감. 노이즈로 획 가장자리를 흔들고(displacement), 거친 알갱이 마스크로 왁스가 덜 묻은 틈을 낸다 */}
            {/* 변경: 거의 평평한 선도 잘리지 않게 필터 영역을 사용자 좌표로 넉넉히 잡는다 */}
            <filter
              id={`crayon-${uid}`}
              filterUnits="userSpaceOnUse"
              x={-width}
              y={-height}
              width={width * 3}
              height={height * 3}
              colorInterpolationFilters="sRGB"
            >
              <feTurbulence type="fractalNoise" baseFrequency="0.045" numOctaves="2" seed="4" result="warp" />
              <feDisplacementMap in="SourceGraphic" in2="warp" scale="3.2" xChannelSelector="R" yChannelSelector="G" result="wobbled" />
              <feTurbulence type="fractalNoise" baseFrequency="1.1" numOctaves="2" seed="9" result="grain" />
              <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.4 0 0 0 -1.15" result="grainMask" />
              <feComposite in="wobbled" in2="grainMask" operator="in" />
            </filter>
            {/* 기능: 종이 결 (아주 옅은 얼룩) */}
            <filter id={`paper-${uid}`} x="0" y="0" width="100%" height="100%">
              <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" seed="2" />
              <feColorMatrix type="matrix" values="0 0 0 0 0.35  0 0 0 0 0.3  0 0 0 0 0.22  0 0 0 0.09 0" />
            </filter>
          </defs>

          <rect width={width} height={height} filter={`url(#paper-${uid})`} />

          {/* 기능: 연결선. 굵은 본선 + 살짝 어긋난 덧칠 선 + 화살촉 순서로, 앞 노드가 나타난 뒤 차례로 그린다 */}
          <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter={filter}>
            {segments.map((seg, k) => {
              const delay = k * step + step * 0.7;
              const dur = step * 1.15;
              return (
                <g key={seg.key} data-testid="route-map-segment">
                  <path
                    d={seg.over}
                    pathLength={1}
                    stroke={LINE_SHADOW}
                    strokeOpacity={0.55}
                    strokeWidth={5.5}
                    className="crayon-draw"
                    style={{ animationDelay: `${delay + 0.06}s`, animationDuration: `${dur}s` }}
                  />
                  <path
                    d={seg.main}
                    pathLength={1}
                    stroke={LINE_COLOR}
                    strokeOpacity={0.92}
                    strokeWidth={3.4}
                    className="crayon-draw"
                    style={{ animationDelay: `${delay}s`, animationDuration: `${dur}s` }}
                  />
                  <path
                    d={seg.arrow}
                    pathLength={1}
                    stroke={LINE_COLOR}
                    strokeOpacity={0.92}
                    strokeWidth={3.2}
                    className="crayon-draw"
                    style={{ animationDelay: `${delay + dur * 0.9}s`, animationDuration: `${Math.max(0.12, step * 0.45)}s` }}
                  />
                </g>
              );
            })}
          </g>

          {/* 기능: 노드. 톡 튀어나오며(pop) 테두리를 두 번 겹쳐 긋고, 안을 지그재그로 색칠한 뒤 번호와 이름이 나타난다 */}
          {nodes.map((node) => {
            const { x, y } = node.center;
            const t = node.order * step;
            const testId = node.kind === "start" ? "route-map-start" : node.kind === "finish" ? "route-map-finish" : `route-map-node-${node.order}`;
            const labelW = Math.min(CELL_W - 24, textUnits(node.label) * 6.7 + 10);
            const isEnd = node.kind !== "checkpoint";
            return (
              <g key={node.key} transform={`translate(${f(x)} ${f(y)}) rotate(${f(node.tilt)})`} data-testid={testId} data-name={node.name}>
                <title>{node.kind === "checkpoint" ? `${node.order}. ${node.name}` : node.name}</title>
                <g className="crayon-pop" style={{ animationDelay: `${t}s`, animationDuration: `${Math.max(0.3, step * 1.1)}s` }}>
                  <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter={filter}>
                    <path
                      d={scribbleFill(0, 0, node.r - 1, `fill:${node.key}`)}
                      pathLength={1}
                      stroke={node.crayon.fill}
                      strokeWidth={5.2}
                      strokeOpacity={0.95}
                      className="crayon-draw"
                      style={{ animationDelay: `${t + 0.05}s`, animationDuration: `${Math.max(0.3, step * 1.3)}s` }}
                    />
                    {/* 변경: 반대 방향으로 한 번 더 문질러 왁스가 겹친 진한 결을 만든다 */}
                    <path
                      d={scribbleFill(0, 0, node.r - 3, `fill2:${node.key}`, 55, 7)}
                      pathLength={1}
                      stroke={node.crayon.stroke}
                      strokeWidth={2.4}
                      strokeOpacity={0.38}
                      className="crayon-draw"
                      style={{ animationDelay: `${t + step * 0.45}s`, animationDuration: `${Math.max(0.3, step * 1.1)}s` }}
                    />
                    <path
                      d={wobblyLoop(0, 0, node.r, `ring:${node.key}`)}
                      pathLength={1}
                      stroke={node.crayon.stroke}
                      strokeWidth={3.6}
                      strokeOpacity={0.95}
                      className="crayon-draw"
                      style={{ animationDelay: `${t}s`, animationDuration: `${Math.max(0.25, step * 0.95)}s` }}
                    />
                    <path
                      d={wobblyLoop(0, 0, node.r + 1.5, `ring2:${node.key}`, 1.05)}
                      pathLength={1}
                      stroke={node.crayon.stroke}
                      strokeWidth={1.8}
                      strokeOpacity={0.6}
                      className="crayon-draw"
                      style={{ animationDelay: `${t + step * 0.35}s`, animationDuration: `${Math.max(0.25, step * 0.9)}s` }}
                    />
                    {node.kind === "finish" ? (
                      // 기능: 골인 노드 위 손그림 깃발
                      <path
                        d={`M${f(node.r * 0.45)},${f(-node.r * 0.85)} L${f(node.r * 0.62)},${f(-node.r * 1.75)} L${f(node.r * 1.35)},${f(-node.r * 1.5)} L${f(node.r * 0.7)},${f(-node.r * 1.25)}`}
                        pathLength={1}
                        stroke={node.crayon.stroke}
                        strokeWidth={3}
                        className="crayon-draw"
                        style={{ animationDelay: `${t + step * 0.6}s`, animationDuration: `${Math.max(0.25, step)}s` }}
                      />
                    ) : null}
                  </g>
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    y={1}
                    className="font-display crayon-fade"
                    fontSize={isEnd ? 17 : 21}
                    fill={TEXT_COLOR}
                    style={{ animationDelay: `${t + step * 0.5}s` }}
                  >
                    {node.kind === "checkpoint" ? node.order : node.name}
                  </text>
                </g>
                {node.kind === "checkpoint" ? (
                  <g className="crayon-fade" style={{ animationDelay: `${t + step * 0.6}s` }}>
                    {/* 기능: 이름 밑을 형광 크레파스로 한 번 문지른 밑줄 */}
                    <path
                      d={wobblyLine(
                        [
                          { x: -labelW / 2, y: node.r + 19 },
                          { x: 0, y: node.r + 18 },
                          { x: labelW / 2, y: node.r + 19.5 },
                        ],
                        `hl:${node.key}`,
                        1.6,
                      ).d}
                      fill="none"
                      stroke={node.crayon.fill}
                      strokeWidth={10}
                      strokeOpacity={0.6}
                      strokeLinecap="round"
                      filter={filter}
                    />
                    <text textAnchor="middle" y={node.r + 22} fontSize={12.5} fontWeight={700} fill={TEXT_COLOR}>
                      {node.label}
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      {/* 기능: 상단 고정 미니 지도. body 로 포털해 페이지 배치를 밀지 않는다 (첫 관찰 결과가 나온 뒤에만 그린다) */}
      {pinned !== null
        ? createPortal(
            <MiniRouteMap
              tags={tags}
              routeKey={routeKey}
              shown={pinned}
              uid={uid}
              onJump={() => wrapRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
            />,
            document.body,
          )
        : null}
    </>
  );
}

const MINI_GAP = 88;
const MINI_PAD = 26;
const MINI_Y = 21;

// 기능: 상단에 작게 쌓이는 한 줄 미니 지도. 같은 크레파스 질감·색으로 출발 → 번호 → 골인 을 그리고, 길면 가로로 스크롤한다
function MiniRouteMap({
  tags,
  routeKey,
  shown,
  uid,
  onJump,
}: {
  tags: RouteMapTag[];
  routeKey: string;
  shown: boolean;
  uid: string;
  onJump: () => void;
}) {
  const nodes = useMemo(() => {
    let prevColor = -1;
    const items = [
      { key: "start", kind: "start" as const, name: "출발" },
      ...tags.map((tag) => ({ key: tag.id, kind: "checkpoint" as const, name: tag.name })),
      { key: "finish", kind: "finish" as const, name: "골인" },
    ];
    return items.map((item, k) => {
      // 변경: 전체 지도와 같은 규칙(지점 id 색, 이웃 색 겹침 방지)으로 색을 고른다
      let colorIndex = hashString(item.key) % CRAYONS.length;
      if (colorIndex === prevColor) colorIndex = (colorIndex + 1) % CRAYONS.length;
      prevColor = item.kind === "checkpoint" ? colorIndex : -1;
      const crayon = item.kind === "start" ? START_CRAYON : item.kind === "finish" ? FINISH_CRAYON : CRAYONS[colorIndex];
      const rand = rng(`mini:${item.key}`);
      return {
        ...item,
        order: k,
        crayon,
        r: item.kind === "checkpoint" ? 13 : 16,
        x: MINI_PAD + k * MINI_GAP,
        y: MINI_Y + (rand() - 0.5) * 3,
        label: truncateName(item.name, 13),
      };
    });
  }, [tags]);
  const width = MINI_PAD * 2 + (nodes.length - 1) * MINI_GAP;
  const height = 54;
  const filter = `url(#crayon-mini-${uid})`;

  return (
    <div className="route-mini pointer-events-none fixed inset-x-0 top-2 z-40 flex justify-center px-3" data-shown={shown ? "true" : "false"} aria-hidden={!shown}>
      <div
        data-testid="route-map-mini"
        className="crayon-paper pointer-events-auto flex w-full max-w-3xl items-center gap-1 rounded-2xl py-1 pr-1 pl-2 text-ink shadow-[0_6px_18px_-8px_rgba(18,22,15,0.45)]"
      >
        <div className="min-w-0 flex-1 overflow-x-auto" style={{ scrollbarWidth: "thin" }}>
          <svg
            key={routeKey}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            className="block"
            role="img"
            aria-label={`경로 순서(미니): ${nodes.map((n) => (n.kind === "checkpoint" ? `${n.order}. ${n.name}` : n.name)).join(" → ")}`}
          >
            <defs>
              {/* 기능: 미니 지도용 크레파스 질감 (작은 크기에 맞춰 흔들림을 줄인다) */}
              <filter id={`crayon-mini-${uid}`} filterUnits="userSpaceOnUse" x={-20} y={-20} width={width + 40} height={height + 40}>
                <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="4" result="warp" />
                <feDisplacementMap in="SourceGraphic" in2="warp" scale="1.4" xChannelSelector="R" yChannelSelector="G" result="wobbled" />
                <feTurbulence type="fractalNoise" baseFrequency="1.3" numOctaves="2" seed="9" result="grain" />
                <feColorMatrix in="grain" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  4.4 0 0 0 -1.05" result="grainMask" />
                <feComposite in="wobbled" in2="grainMask" operator="in" />
              </filter>
            </defs>
            <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter={filter}>
              {nodes.slice(0, -1).map((a, k) => {
                const b = nodes[k + 1];
                const line = wobblyLine(
                  [
                    { x: a.x + a.r + 5, y: a.y },
                    { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (rng(`mseg:${a.key}`)() - 0.5) * 5 },
                    { x: b.x - b.r - 6, y: b.y },
                  ],
                  `mseg:${a.key}>${b.key}`,
                  1.4,
                );
                return (
                  <g key={`${a.key}>${b.key}`} className="crayon-draw" style={{ animationDelay: `${k * 0.07 + 0.05}s`, animationDuration: "0.25s" }}>
                    <path d={line.d} stroke={LINE_COLOR} strokeWidth={2.4} strokeOpacity={0.9} />
                    <path d={arrowHead(line.end, line.prev, `marrow:${a.key}`, 6)} stroke={LINE_COLOR} strokeWidth={2.2} strokeOpacity={0.9} />
                  </g>
                );
              })}
            </g>
            {nodes.map((node) => {
              const testId =
                node.kind === "start" ? "route-map-mini-start" : node.kind === "finish" ? "route-map-mini-finish" : `route-map-mini-node-${node.order}`;
              return (
                <g key={node.key} transform={`translate(${f(node.x)} ${f(node.y)})`} data-testid={testId} data-name={node.name}>
                  <title>{node.kind === "checkpoint" ? `${node.order}. ${node.name}` : node.name}</title>
                  <g className="crayon-pop" style={{ animationDelay: `${node.order * 0.07}s`, animationDuration: "0.3s" }}>
                    <g fill="none" strokeLinecap="round" strokeLinejoin="round" filter={filter}>
                      <path d={scribbleFill(0, 0, node.r - 1, `mfill:${node.key}`, -30, 3.6)} stroke={node.crayon.fill} strokeWidth={4} />
                      <path d={wobblyLoop(0, 0, node.r, `mring:${node.key}`, 1.1, 0.45)} stroke={node.crayon.stroke} strokeWidth={2.4} />
                    </g>
                    <text
                      textAnchor="middle"
                      dominantBaseline="central"
                      y={0.5}
                      className="font-display"
                      fontSize={node.kind === "checkpoint" ? 13 : 10.5}
                      fill={TEXT_COLOR}
                    >
                      {node.kind === "checkpoint" ? node.order : node.name}
                    </text>
                  </g>
                  {node.kind === "checkpoint" ? (
                    <text textAnchor="middle" y={node.r + 15} fontSize={10.5} fontWeight={600} fill={TEXT_COLOR}>
                      {node.label}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </svg>
        </div>
        {/* 기능: 전체 지도로 돌아가기 (편집이 아니라 스크롤 이동만) */}
        <button
          type="button"
          onClick={onJump}
          tabIndex={shown ? 0 : -1}
          className="shrink-0 rounded-full bg-ink/85 px-2.5 py-1.5 text-[11px] font-semibold whitespace-nowrap text-paper"
        >
          ↑ 지도
        </button>
      </div>
    </div>
  );
}
