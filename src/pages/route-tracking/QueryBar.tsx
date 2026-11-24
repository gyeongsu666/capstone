import { useState } from 'react';
import { App, Button, Popover, Progress, Slider, Space, Spin, Tooltip } from 'antd';
import {
  CameraOutlined,
  ClockCircleOutlined,
  PercentageOutlined,
  ReloadOutlined,
  SwapOutlined,
} from '@ant-design/icons';
import { isApiError } from '@/api/client';
import { useRunSearch, useUpdateThreshold } from '@/api/tracking';
import type { QueryView, TaskView } from '@/api/view';
import { formatDateTime, formatSimilarity } from '@/utils/format';

const chipStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  height: 32,
  padding: '0 10px',
  border: '1px solid #d9d9d9',
  borderRadius: 16,
  background: '#fff',
  cursor: 'pointer',
  fontSize: 13,
} as const;

interface QueryBarProps {
  caseId: string;
  query: QueryView;
  readOnly: boolean;
  /** 진행 중인 후보 검색 */
  searchTask?: TaskView;
  /** 진행 중인 특징 추출 */
  embedTask?: TaskView;
  onUpload: () => void;
  /** 다시 검색할 때 기준이 되는 마지막 확정 판단(없으면 최초 목격 기준) */
  anchorDecisionId: string | null;
}

/** 질의 바: 기준 사진 · 시간 범위 · 유사도 기준을 칩으로 항상 표시. 조건을 바꾸면 그 자리에서 다시 검색 */
export function QueryBar({
  caseId,
  query,
  readOnly,
  searchTask,
  embedTask,
  onUpload,
  anchorDecisionId,
}: QueryBarProps) {
  const { message } = App.useApp();
  const updateThreshold = useUpdateThreshold(caseId);
  const runSearch = useRunSearch(caseId);
  const [draft, setDraft] = useState(query.threshold);
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const searching = !!searchTask;
  const hasReady = query.status === 'ready';
  const thresholdDefault = query.thresholdDefault;

  const errorText = (e: unknown, fallback: string) => (isApiError(e) ? e.detail : fallback);

  // 기준 대상은 사진 한 장 또는 트랙렛 하나(요청서 3.2). 바꾸기만 있고 따로 지우지는 않는다
  const photos = (
    <div style={{ width: 240 }}>
      {query.imageUrl ? (
        <div style={{ position: 'relative', width: 96 }}>
          <img
            src={query.imageUrl}
            alt="기준 대상"
            style={{
              width: 96,
              height: 120,
              objectFit: 'cover',
              borderRadius: 4,
              display: 'block',
            }}
          />
          {query.status === 'embedding' && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgba(255,255,255,0.7)',
              }}
            >
              <Spin size="small" />
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 13, color: 'rgba(0,0,0,0.55)' }}>아직 기준 대상이 없어요.</div>
      )}
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', margin: '6px 0' }}>
        {query.source === 'tracklet' ? '영상 속 인물을 기준으로 골랐어요.' : '올린 사진이에요.'}
        {query.status === 'failed' && ' 특징을 뽑지 못했어요. 다른 사진을 올려 주세요.'}
      </div>
      {!readOnly && (
        <Tooltip
          title={query.locked ? '확정한 장면이 있어 기준 대상을 바꿀 수 없어요.' : undefined}
        >
          <Button icon={<SwapOutlined />} block disabled={query.locked} onClick={onUpload}>
            {query.imageUrl ? '사진 바꾸기' : '사진 올리기'}
          </Button>
        </Tooltip>
      )}
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 6 }}>
        사진을 올리면 특징을 뽑은 뒤 자동으로 검색해요.
      </div>
    </div>
  );

  const thresholdEditor = (
    <div style={{ width: 280 }}>
      <Slider
        min={0.3}
        max={0.95}
        step={0.01}
        value={draft}
        onChange={setDraft}
        marks={thresholdDefault === null ? undefined : { [thresholdDefault]: '기본' }}
        tooltip={{ formatter: (v) => formatSimilarity(v ?? 0) }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="num" style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          관리자 기본값 {thresholdDefault === null ? '미정' : formatSimilarity(thresholdDefault)}
        </span>
        <Space>
          <Button
            size="small"
            disabled={thresholdDefault === null}
            onClick={() => thresholdDefault !== null && setDraft(thresholdDefault)}
          >
            기본값
          </Button>
          <Button
            size="small"
            type="primary"
            loading={updateThreshold.isPending}
            disabled={draft === query.threshold}
            onClick={() =>
              updateThreshold.mutate(draft, {
                onSuccess: () => setThresholdOpen(false),
                onError: (e) => message.error(errorText(e, '유사도 기준을 바꾸지 못했어요.')),
              })
            }
          >
            적용하고 다시 검색
          </Button>
        </Space>
      </div>
    </div>
  );

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '10px 16px',
        background: '#fff',
        borderBottom: '1px solid #e8ebf0',
        flex: 'none',
      }}
    >
      <Popover content={photos} title="기준 사진" trigger="click" placement="bottomLeft">
        <span style={chipStyle} role="button" tabIndex={0}>
          <CameraOutlined />
          기준 사진
          {query.imageUrl ? (
            <img
              src={query.imageUrl}
              alt=""
              style={{
                width: 20,
                height: 24,
                objectFit: 'cover',
                borderRadius: 3,
                opacity: query.status === 'ready' ? 1 : 0.4,
              }}
            />
          ) : (
            <span style={{ color: 'rgba(0,0,0,0.45)' }}>없음</span>
          )}
          {embedTask && <Spin size="small" />}
        </span>
      </Popover>

      <Tooltip title="실종 시각부터 지금까지의 영상에서 찾아요">
        <span style={{ ...chipStyle, cursor: 'default' }}>
          <ClockCircleOutlined />
          <span className="num">
            {formatDateTime(query.timeFrom)} ~{' '}
            {query.timeTo ? formatDateTime(query.timeTo) : '현재'}
          </span>
        </span>
      </Tooltip>

      <Popover
        content={thresholdEditor}
        title="유사도 기준"
        trigger="click"
        open={thresholdOpen && !readOnly}
        onOpenChange={(o) => {
          setThresholdOpen(o);
          if (o) setDraft(query.threshold);
        }}
        placement="bottomLeft"
      >
        <span style={chipStyle} role="button" tabIndex={0}>
          <PercentageOutlined />
          유사도 기준
          <b className="num">{formatSimilarity(query.threshold)}</b>
          {thresholdDefault !== null && query.threshold !== thresholdDefault && (
            <span className="num" style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
              (기본 {formatSimilarity(thresholdDefault)})
            </span>
          )}
        </span>
      </Popover>

      <span style={{ flex: 1 }} />

      {searching ? (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, width: 220 }}>
          <span style={{ fontSize: 13, whiteSpace: 'nowrap' }}>후보 검색 중</span>
          <Progress percent={searchTask?.progress ?? 0} size="small" status="active" />
        </span>
      ) : (
        !readOnly && (
          <Tooltip
            title={hasReady ? '지금 조건으로 다시 검색' : '특징 추출이 끝난 기준 대상이 필요해요'}
          >
            <Button
              icon={<ReloadOutlined />}
              disabled={!hasReady}
              loading={runSearch.isPending}
              onClick={() =>
                runSearch.mutate(
                  { anchorDecisionId },
                  {
                    onError: (e) => message.error(errorText(e, '검색을 시작하지 못했어요.')),
                  },
                )
              }
            >
              다시 검색
            </Button>
          </Tooltip>
        )
      )}
    </div>
  );
}
