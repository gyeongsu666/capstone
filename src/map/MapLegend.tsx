import type { ReactNode } from 'react';
import { areaLevelColor, mapColor } from '@/theme';

/** 범례 항목. 화면마다 그 화면에 나오는 것만 넘긴다. */
export type LegendKey =
  | 'camera'
  | 'cameraNotAnalyzed'
  | 'caseCamera'
  | 'sector'
  | 'walkEdge'
  | 'detour'
  | 'danger'
  | 'route'
  | 'routePending'
  | 'currentCandidate'
  | 'area'
  | 'liveAlert';

const W = 22;
const H = 14;

const line = (color: string, dash: string | undefined, width: number) => (
  <svg width={W} height={H} aria-hidden>
    <line
      x1="1"
      y1={H / 2}
      x2={W - 1}
      y2={H / 2}
      stroke={color}
      strokeWidth={width}
      strokeDasharray={dash}
    />
  </svg>
);

const ITEMS: Record<LegendKey, { swatch: ReactNode; label: ReactNode }> = {
  camera: {
    swatch: (
      <svg width={W} height={H} aria-hidden>
        <circle
          cx={W / 2}
          cy={H / 2}
          r={6}
          fill={mapColor.camera}
          stroke="#fff"
          strokeWidth={1.5}
        />
      </svg>
    ),
    label: '카메라',
  },
  cameraNotAnalyzed: {
    swatch: (
      <svg width={W} height={H} aria-hidden>
        <circle
          cx={W / 2}
          cy={H / 2}
          r={6}
          fill={mapColor.cameraNotAnalyzed}
          stroke="#fff"
          strokeWidth={1.5}
        />
      </svg>
    ),
    label: '분석 전',
  },
  caseCamera: {
    swatch: (
      <svg width={W} height={H} aria-hidden>
        <rect x={W / 2 - 6} y={1} width={12} height={12} rx={2} fill={mapColor.camera} />
      </svg>
    ),
    label: '사건 영상',
  },
  sector: {
    swatch: (
      <svg width={W} height={H} aria-hidden>
        <path
          d={`M${W / 2} ${H} L3 2 Q${W / 2} -2 ${W - 3} 2 Z`}
          fill={mapColor.camera}
          opacity={0.3}
        />
      </svg>
    ),
    label: '촬영 방향',
  },
  walkEdge: { swatch: line(mapColor.walkEdge, '3 3', 2), label: '도보 경로' },
  detour: {
    swatch: line(mapColor.detour, '5 3', 3),
    label: <span style={{ color: '#b45309' }}>우회 의심</span>,
  },
  danger: {
    swatch: (
      <svg width={W} height={H} aria-hidden>
        <rect
          x={2}
          y={2}
          width={W - 4}
          height={H - 4}
          fill={mapColor.dangerZone}
          fillOpacity={0.15}
          stroke={mapColor.dangerZone}
          strokeDasharray="3 2"
        />
      </svg>
    ),
    label: <span style={{ color: mapColor.dangerZone }}>위험 지역</span>,
  },
  route: { swatch: line(mapColor.route, undefined, 4), label: '확정 동선' },
  routePending: {
    swatch: line(mapColor.routePending, '5 3', 4),
    label: <span style={{ color: '#b45309' }}>확인 대기</span>,
  },
  currentCandidate: {
    swatch: (
      <svg width={W} height={H} aria-hidden>
        <circle cx={W / 2} cy={H / 2} r={4} fill={mapColor.camera} />
        <circle
          cx={W / 2}
          cy={H / 2}
          r={6.5}
          fill="none"
          stroke={mapColor.currentCandidateRing}
          strokeWidth={1.5}
        />
      </svg>
    ),
    label: '지금 확인 중',
  },
  area: {
    swatch: (
      <svg width={W + 18} height={H} aria-hidden>
        <rect x={1} y={2} width={12} height={10} fill={areaLevelColor.HIGH} opacity={0.75} />
        <rect x={14} y={2} width={12} height={10} fill={areaLevelColor.MID} opacity={0.6} />
        <rect x={27} y={2} width={12} height={10} fill={areaLevelColor.LOW} opacity={0.6} />
      </svg>
    ),
    label: '현재 위치 가능성 높음·중간·낮음',
  },
  liveAlert: {
    swatch: (
      <svg width={W} height={H} aria-hidden>
        <circle cx={W / 2} cy={H / 2} r={4} fill={mapColor.liveAlert} />
        <circle
          cx={W / 2}
          cy={H / 2}
          r={6.5}
          fill="none"
          stroke={mapColor.liveAlert}
          strokeWidth={1}
          opacity={0.6}
        />
      </svg>
    ),
    label: <span style={{ color: mapColor.liveAlert }}>실시간 출현</span>,
  },
};

/** 범례: 지도 왼쪽 아래에 항상, 그 화면에 나오는 요소만. 색과 모양·선 종류를 함께 보여준다. */
export function MapLegend({ items }: { items: LegendKey[] }) {
  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '4px 12px',
        maxWidth: 520,
        padding: '6px 10px',
        background: 'rgba(255,255,255,0.95)',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        fontSize: 12,
        color: 'rgba(0,0,0,0.75)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.1)',
      }}
    >
      {items.map((k) => (
        <span key={k} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {ITEMS[k].swatch}
          {ITEMS[k].label}
        </span>
      ))}
    </div>
  );
}
