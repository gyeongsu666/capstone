import { useState } from 'react';
import { App, Button, Popconfirm, Popover, Progress, Slider, Space, Spin, Tooltip } from 'antd';
import {
  CameraOutlined,
  ClockCircleOutlined,
  DeleteOutlined,
  PercentageOutlined,
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { isApiError } from '@/api/client';
import { useDeleteQueryImage, useRunSearch, useUpdateThreshold } from '@/api/tracking';
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
}

/** 질의 바: 기준 사진 · 시간 범위 · 유사도 기준을 칩으로 항상 표시. 조건을 바꾸면 그 자리에서 다시 검색 */
export function QueryBar({
  caseId,
  query,
  readOnly,
  searchTask,
  embedTask,
  onUpload,
}: QueryBarProps) {
  const { message } = App.useApp();
  const updateThreshold = useUpdateThreshold(caseId);
  const runSearch = useRunSearch(caseId);
  const deleteImage = useDeleteQueryImage(caseId);
  const [draft, setDraft] = useState(query.threshold);
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const searching = !!searchTask;
  const hasReady = query.images.some((i) => i.ready);

  const errorText = (e: unknown, fallback: string) => (isApiError(e) ? e.detail : fallback);

  const photos = (
    <div style={{ width: 260 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {query.images.map((img) => (
          <div key={img.id} style={{ position: 'relative', width: 72 }}>
            <img
              src={img.url}
              alt="기준 사진"
              style={{
                width: 72,
                height: 90,
                objectFit: 'cover',
                borderRadius: 4,
                display: 'block',
              }}
            />
            {!img.ready && (
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  display: 'grid',
                  placeItems: 'center',
                  background: 'rgba(255,255,255,0.7)',
                  fontSize: 12,
                }}
              >
                <Spin size="small" />
              </div>
            )}
            {!readOnly && (
              <Popconfirm
                title="이 기준 사진을 뺄까요?"
                okText="빼기"
                cancelText="취소"
                onConfirm={() =>
                  deleteImage.mutate(img.id, {
                    onError: (e) => message.error(errorText(e, '사진을 빼지 못했어요.')),
                  })
                }
              >
                <Button
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  aria-label="기준 사진 빼기"
                  style={{ position: 'absolute', top: 2, right: 2 }}
                />
              </Popconfirm>
            )}
          </div>
        ))}
      </div>
      {!readOnly && (
        <Button icon={<PlusOutlined />} block style={{ marginTop: 8 }} onClick={onUpload}>
          사진 추가
        </Button>
      )}
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 6 }}>
        사진을 추가하면 특징을 뽑은 뒤 자동으로 다시 검색해요.
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
        marks={{ [query.thresholdDefault]: '기본' }}
        tooltip={{ formatter: (v) => formatSimilarity(v ?? 0) }}
      />
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span className="num" style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          관리자 기본값 {formatSimilarity(query.thresholdDefault)}
        </span>
        <Space>
          <Button size="small" onClick={() => setDraft(query.thresholdDefault)}>
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
          <span style={{ display: 'inline-flex', gap: 2 }}>
            {query.images.slice(0, 3).map((img) => (
              <img
                key={img.id}
                src={img.url}
                alt=""
                style={{
                  width: 20,
                  height: 24,
                  objectFit: 'cover',
                  borderRadius: 3,
                  opacity: img.ready ? 1 : 0.4,
                }}
              />
            ))}
          </span>
          <span className="num">{query.images.length}장</span>
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
          {query.threshold !== query.thresholdDefault && (
            <span className="num" style={{ fontSize: 12, color: 'rgba(0,0,0,0.5)' }}>
              (기본 {formatSimilarity(query.thresholdDefault)})
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
            title={hasReady ? '지금 조건으로 다시 검색' : '특징 추출이 끝난 기준 사진이 필요해요'}
          >
            <Button
              icon={<ReloadOutlined />}
              disabled={!hasReady}
              loading={runSearch.isPending}
              onClick={() =>
                runSearch.mutate(undefined, {
                  onError: (e) => message.error(errorText(e, '검색을 시작하지 못했어요.')),
                })
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
