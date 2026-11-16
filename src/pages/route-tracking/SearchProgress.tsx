import { Progress, Steps } from 'antd';
import { LoadingOutlined, SearchOutlined } from '@ant-design/icons';
import type { TaskView } from '@/api/view';

/** 후보 검색이 하는 일(SYS02-003). 진행률 구간으로 지금 단계를 보여준다 */
const STAGES = [
  { title: '검색 준비', description: '기준 사진 특징과 검색 조건을 확인해요', from: 0 },
  {
    title: '시간·공간 필터',
    description: '도보로 갈 수 있는 카메라와 시간대의 장면만 추려요',
    from: 40,
  },
  {
    title: '유사도 비교·경로 검사',
    description: '기준 사진과 비교하고, 이동 시간·방향이 안 맞으면 순위를 내려요',
    from: 80,
  },
] as const;

interface SearchProgressProps {
  task: TaskView | undefined;
  /** 검색 기준점 설명. 예: "C3 15:02 이후" */
  anchorLabel: string | null;
}

/** 후보 검색 진행 화면: 단계 + 진행률 */
export function SearchProgress({ task, anchorLabel }: SearchProgressProps) {
  const progress = task?.progress ?? 0;
  const current = STAGES.reduce((idx, s, i) => (progress >= s.from ? i : idx), 0);

  return (
    <div style={{ width: 420 }}>
      <div style={{ textAlign: 'center', marginBottom: 16 }}>
        <SearchOutlined style={{ fontSize: 28, color: '#1677ff' }} />
        <div style={{ fontSize: 16, fontWeight: 600, marginTop: 8 }}>후보를 검색하고 있어요</div>
        {anchorLabel && (
          <div className="num" style={{ fontSize: 13, color: 'rgba(0,0,0,0.6)' }}>
            기준점: {anchorLabel}
          </div>
        )}
      </div>
      <Steps
        direction="vertical"
        size="small"
        current={current}
        items={STAGES.map((s, i) => ({
          title: s.title,
          description: s.description,
          icon: i === current ? <LoadingOutlined /> : undefined,
        }))}
      />
      <Progress percent={progress} status="active" />
    </div>
  );
}
