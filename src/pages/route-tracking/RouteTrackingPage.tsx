import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { Alert, App, Button, Card, Progress, Segmented, Spin, Tabs } from 'antd';
import { AimOutlined, CameraOutlined, SearchOutlined } from '@ant-design/icons';
import { useCaseView } from '@/api/cases';
import { queryKeys } from '@/api/queryKeys';
import { isApiError } from '@/api/client';
import {
  getCandidates,
  useDecide,
  useDecisions,
  useEmbedTask,
  useQueryConditions,
  useQueue,
  useRevert,
  useRoute,
  useRunSearch,
  useSearchTask,
  useUploadQueryImage,
} from '@/api/tracking';
import { toQueueView, type CandidateView, type QueueView, type VerdictView } from '@/api/view';
import { PageHeader } from '@/app/layout/PageHeader';
import { ConfirmArea } from '@/components/ConfirmArea';
import { DecisionLog } from '@/components/DecisionLog';
import { EmptyState } from '@/components/EmptyState';
import { CaseManageMenu } from '@/pages/cases/manage/CaseManageMenu';
import { CandidateQueue } from '@/pages/route-tracking/CandidateQueue';
import { QueryBar } from '@/pages/route-tracking/QueryBar';
import { SearchProgress } from '@/pages/route-tracking/SearchProgress';
import { TimelineTab } from '@/pages/route-tracking/TimelineTab';
import { TrackingMap } from '@/pages/route-tracking/TrackingMap';
import { useTrackingStore, type TrackingMode } from '@/stores/tracking';
import { useUndoToastStore } from '@/stores/undoToast';
import { PANEL_WIDTH } from '@/theme';
import { formatElapsedSince, formatTime } from '@/utils/format';
import { useNow } from '@/utils/useNow';

/** 마지막 후보 검색 결과(화면 위 안내와 "새 후보" 표시) */
interface SearchResult {
  caseId: string;
  at: string;
  total: number;
  above: number;
  below: number;
  newIds: string[];
  cameraCount: number | null;
  anchorLabel: string | null;
}

const VERDICT_TEXT: Record<VerdictView, string> = { yes: '확정함', no: '제외함', hold: '보류함' };
const BOTTOM_HEIGHT = 230;

function Center({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        display: 'grid',
        placeItems: 'center',
        background: '#fff',
        borderRadius: 8,
      }}
    >
      {children}
    </div>
  );
}

/**
 * 동선 추적: 후보 검색 · 장면 확인 · 경로 확인을 한 화면에서.
 * 질의 바 → 검토/지도 전환(확인 영역 · 미니맵 · 대기열) → 아래 탭(타임라인 | 결정 기록)
 */
export function RouteTrackingPage() {
  const { caseId = '' } = useParams<{ caseId: string }>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const now = useNow();
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: caseView } = useCaseView(caseId, { poll: true });
  const { data: query } = useQueryConditions(caseId);
  const { data: queue, isLoading: queueLoading } = useQueue(caseId);
  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);
  const { data: route } = useRoute(caseId);
  const { data: decisions = [], isLoading: decisionsLoading } = useDecisions(caseId);
  const decide = useDecide(caseId);
  const revert = useRevert(caseId);
  const runSearch = useRunSearch(caseId);
  const upload = useUploadQueryImage(caseId);
  const showUndo = useUndoToastStore((s) => s.show);

  const qc = useQueryClient();
  // 검색 전 대기열(새 후보를 가려내기 위해)
  const queueRef = useRef<QueueView | undefined>(undefined);
  const anchorLabelRef = useRef<string | null>(null);
  const [searchResult, setSearchResult] = useState<SearchResult | null>(null);

  const { task: searchTask } = useSearchTask(caseId, async (t) => {
    if (t.status === 'failed') {
      message.error(`후보 검색이 실패했어요. ${t.error ?? ''}`);
      return;
    }
    const before = new Set((queueRef.current?.items ?? []).map((c) => c.id));
    const raw = await qc.fetchQuery({
      queryKey: queryKeys.tracking.queue(caseId),
      queryFn: () => getCandidates(caseId),
    });
    const after = toQueueView(raw).items;
    const above = after.filter((c) => !c.belowThreshold).length;
    const newIds = after.filter((c) => !before.has(c.id)).map((c) => c.id);
    setSearchResult({
      caseId,
      at: new Date().toISOString(),
      total: after.length,
      above,
      below: after.length - above,
      newIds,
      cameraCount: Number(t.result?.searched_camera_count ?? 0) || null,
      anchorLabel: anchorLabelRef.current,
    });
    message.success(
      `검색이 끝났어요. 후보 ${after.length}개${newIds.length ? ` · 새 후보 ${newIds.length}개` : ' · 새 후보 없음'}`,
    );
  });
  const { task: embedTask } = useEmbedTask(caseId, (t) => {
    if (t.status === 'done') message.success('기준 사진 특징을 뽑았어요. 후보 검색을 시작해요.');
    else message.error(t.error ?? '사진에서 사람을 찾지 못했어요. 다른 사진을 올려 주세요.');
  });

  const mode = useTrackingStore((s) => s.mode);
  const setMode = useTrackingStore((s) => s.setMode);
  const selectedId = useTrackingStore((s) => s.selectedCandidateId);
  const select = useTrackingStore((s) => s.select);
  const focused = useTrackingStore((s) => s.focused);
  const setFocused = useTrackingStore((s) => s.setFocused);
  const myDecidedIds = useTrackingStore((s) => s.myDecidedIds);
  const addMyDecided = useTrackingStore((s) => s.addMyDecided);
  const searchedNow = useTrackingStore((s) => s.searchedCases.includes(caseId));

  // 사건을 바꾸면 선택을 비운다
  useEffect(() => {
    select(null);
    setFocused(null);
  }, [caseId, select, setFocused]);

  const readOnly = !!caseView?.closed;
  // 검색 기준점: 마지막 확정 장면(없으면 마지막 확인 장소)
  const lastConfirmed = route?.scenes.filter((x) => x.status === 'confirmed').at(-1);
  const anchorLabel = lastConfirmed
    ? `${lastConfirmed.scene.cameraCode} ${formatTime(lastConfirmed.scene.startAt)} 이후`
    : '마지막 확인 장소 기준';
  useEffect(() => {
    anchorLabelRef.current = anchorLabel;
  }, [anchorLabel]);
  const result = searchResult?.caseId === caseId ? searchResult : null;
  const searching = !!searchTask;
  const items = queue?.items ?? [];
  const above = items.filter((c) => !c.belowThreshold);

  // 공동 담당자가 먼저 판단해 대기열에서 빠진 후보는 "OO님이 확정함"으로 그대로 보여준다
  const otherDecision =
    focused && !items.some((c) => c.id === focused.id) && !myDecidedIds.includes(focused.id)
      ? decisions.find((d) => d.candidateId === focused.id && !d.revert)
      : undefined;
  const current: CandidateView | undefined = otherDecision
    ? (focused ?? undefined)
    : (items.find((c) => c.id === selectedId) ?? above[0]);

  useEffect(() => {
    if (!otherDecision && current && current.id !== focused?.id) setFocused(current);
  }, [current, focused, otherDecision, setFocused]);

  const onDecide = (verdict: VerdictView) => {
    if (!current || decide.isPending) return;
    const c = current;
    addMyDecided(c.id);
    select(null);
    setFocused(null);
    decide.mutate(
      { candidateId: c.id, verdict },
      {
        onSuccess: (res) => {
          showUndo(
            `${c.scene.cameraCode} ${formatTime(c.scene.startAt)} ${VERDICT_TEXT[verdict]}`,
            () =>
              revert.mutate(res.decision.id, {
                onSuccess: () => message.info('판단을 되돌렸어요.'),
                onError: (e) => message.error(isApiError(e) ? e.detail : '되돌리지 못했어요.'),
              }),
          );
        },
        onError: (e) => {
          if (isApiError(e, 'ALREADY_DECIDED')) {
            message.warning(e.detail);
            // 먼저 판단한 사람 안내를 보여주기 위해 이 후보를 계속 보여준다
            useTrackingStore.setState((s) => ({
              myDecidedIds: s.myDecidedIds.filter((id) => id !== c.id),
              focused: c,
            }));
          } else {
            message.error(isApiError(e) ? e.detail : '판단을 저장하지 못했어요.');
          }
        },
      },
    );
  };

  const onRevert = (decisionId: string) =>
    revert.mutate(decisionId, {
      onSuccess: (res) =>
        message.success(
          res.affected.length > 1
            ? `번복했어요. 이후 확정 장면 ${res.affected.length - 1}개는 '재확인 필요'로 바뀌었어요.`
            : '번복했어요. 후보가 대기열로 돌아왔어요.',
        ),
      onError: (e) => message.error(isApiError(e) ? e.detail : '번복하지 못했어요.'),
    });

  const onPick = (c: CandidateView) => {
    select(c.id);
    setFocused(c);
  };

  const openUpload = () => fileInput.current?.click();

  // ---------- 가운데(확인 영역 자리) ----------

  const centerContent = (compact: boolean): ReactNode => {
    if (!query || queueLoading) {
      return (
        <Center>
          <Spin />
        </Center>
      );
    }
    if (query.images.length === 0) {
      return (
        <Center>
          <EmptyState
            icon={<CameraOutlined />}
            message="기준 사진을 올리면 후보 검색을 시작해요"
            actionLabel={readOnly ? undefined : '사진 올리기'}
            onAction={openUpload}
          />
        </Center>
      );
    }
    if (embedTask && !query.images.some((i) => i.ready)) {
      return (
        <Center>
          <div style={{ width: 280, textAlign: 'center' }}>
            <div style={{ marginBottom: 8 }}>기준 사진에서 특징을 뽑고 있어요</div>
            <Progress percent={embedTask.progress} status="active" />
          </div>
        </Center>
      );
    }
    if (searching) {
      return (
        <Center>
          <SearchProgress task={searchTask} anchorLabel={anchorLabel} />
        </Center>
      );
    }
    if (current) {
      return (
        <div style={{ height: '100%', overflowY: 'auto' }}>
          <ConfirmArea
            candidate={current}
            queryImageUrl={query.images.find((i) => i.ready)?.url ?? query.images[0].url}
            onDecide={onDecide}
            pending={decide.isPending ? (decide.variables?.verdict ?? null) : null}
            decidedBy={
              otherDecision
                ? { name: otherDecision.decidedByName, verdict: otherDecision.verdict }
                : null
            }
            readOnly={readOnly}
            remaining={above.filter((c) => c.status !== 'held').length}
            compact={compact}
          />
          {otherDecision && (
            <div style={{ textAlign: 'right', marginTop: 8 }}>
              <Button
                type="primary"
                onClick={() => {
                  setFocused(null);
                  select(null);
                }}
              >
                다음 후보 보기
              </Button>
            </div>
          )}
        </div>
      );
    }
    if (items.length > 0) {
      return (
        <Center>
          <EmptyState message="기준 이상 후보가 없어요. 기준 미만 후보를 보거나 유사도 기준을 낮춰 보세요." />
        </Center>
      );
    }
    if (!route || route.scenes.length === 0) {
      return (
        <Center>
          <EmptyState
            icon={<SearchOutlined />}
            message={
              searchedNow
                ? '검색했지만 후보가 없어요. 유사도 기준을 낮추거나 기준 사진을 바꿔 다시 검색하세요'
                : '아직 후보가 없어요. 후보 검색을 시작하세요'
            }
            actionLabel={readOnly ? undefined : searchedNow ? '다시 검색' : '후보 검색'}
            onAction={() =>
              runSearch.mutate(undefined, {
                onError: (e) =>
                  message.error(isApiError(e) ? e.detail : '검색을 시작하지 못했어요.'),
              })
            }
          />
        </Center>
      );
    }
    return (
      <Center>
        <EmptyState
          icon={<AimOutlined />}
          message="더 이상 후보가 없어요. 현재 위치 수색으로 넘어가세요"
          actionLabel="현재 위치 수색"
          onAction={() => navigate(`/cases/${caseId}/search-area`)}
        />
      </Center>
    );
  };

  const queuePanel = (
    <Card
      size="small"
      title={
        <span>
          후보 대기열{' '}
          <span
            className="num"
            style={{ fontWeight: 400, fontSize: 12, color: 'rgba(0,0,0,0.55)' }}
          >
            {route?.scenes.length
              ? `${route.scenes.at(-1)!.scene.cameraCode} ${formatTime(route.scenes.at(-1)!.scene.startAt)} 이후 · 도보 가능`
              : ''}
          </span>
        </span>
      }
      style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}
      styles={{ body: { padding: 0, overflowY: 'auto', flex: 1 } }}
    >
      {queue && query && items.length > 0 ? (
        <CandidateQueue
          newIds={result?.newIds}
          queue={queue}
          threshold={query.threshold}
          activeId={current?.id ?? null}
          onSelect={onPick}
          dimmed={searching}
        />
      ) : (
        <div style={{ padding: 16, fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
          {searching ? '검색이 끝나면 후보가 나와요.' : '대기 중인 후보가 없어요.'}
        </div>
      )}
    </Card>
  );

  const lastSeen =
    caseView?.lastSeenAt && caseView.lastSeenCameraCode
      ? ` · 마지막 목격 ${caseView.lastSeenCameraCode} ${formatTime(caseView.lastSeenAt)} (${formatElapsedSince(caseView.lastSeenAt, now)})`
      : '';

  return (
    <>
      <PageHeader
        title="동선 추적"
        summary={
          caseView
            ? `확정 ${caseView.confirmedCount} · 확인 대기 ${caseView.pendingCount}${lastSeen}`
            : undefined
        }
        extra={
          <>
            {route && route.scenes.length > 0 && (
              <Button
                icon={<AimOutlined />}
                onClick={() => navigate(`/cases/${caseId}/search-area`)}
              >
                현재 위치 수색
              </Button>
            )}
            <CaseManageMenu caseId={caseId} />
          </>
        }
      />
      {query && (
        <QueryBar
          caseId={caseId}
          query={query}
          readOnly={readOnly}
          searchTask={searchTask}
          embedTask={embedTask}
          onUpload={openUpload}
        />
      )}
      <input
        ref={fileInput}
        type="file"
        accept="image/jpeg,image/png"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (file)
            upload.mutate(file, {
              onError: (err) =>
                message.error(isApiError(err) ? err.detail : '사진을 올리지 못했어요.'),
            });
        }}
      />

      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 16px 0',
        }}
      >
        {result && !searching && (
          <Alert
            type="info"
            showIcon
            closable
            onClose={() => setSearchResult(null)}
            style={{ marginBottom: 8 }}
            message={
              <span className="num">
                {formatTime(result.at)} 검색 완료 · {result.anchorLabel}
                {result.cameraCount
                  ? ` 도보로 갈 수 있는 카메라 ${result.cameraCount}대에서`
                  : ''}{' '}
                후보 <b>{result.total}개</b>를 찾았어요 (기준 이상 {result.above} · 기준 미만{' '}
                {result.below}) ·{' '}
                {result.newIds.length ? (
                  <b>새 후보 {result.newIds.length}개</b>
                ) : (
                  '새 후보 없음(이전 검색과 같아요)'
                )}
              </span>
            }
          />
        )}
        <Segmented<TrackingMode>
          value={mode}
          onChange={setMode}
          options={[
            { label: '검토', value: 'review' },
            { label: '지도', value: 'map' },
          ]}
          style={{ alignSelf: 'flex-start', marginBottom: 8 }}
        />
        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0, borderRadius: 8, overflow: 'hidden' }}>
            {mode === 'review' ? (
              centerContent(false)
            ) : (
              <TrackingMap
                caseId={caseId}
                route={route}
                activeCameraId={current?.scene.cameraId ?? null}
              />
            )}
          </div>
          <aside
            style={{
              width: PANEL_WIDTH,
              flex: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              minHeight: 0,
            }}
          >
            {mode === 'review' ? (
              <Card size="small" styles={{ body: { padding: 0, height: 190 } }}>
                <TrackingMap
                  caseId={caseId}
                  route={route}
                  activeCameraId={current?.scene.cameraId ?? null}
                  mini
                />
              </Card>
            ) : (
              <div style={{ maxHeight: '60%', overflowY: 'auto', flex: 'none' }}>
                {centerContent(true)}
              </div>
            )}
            {queuePanel}
          </aside>
        </div>
      </div>

      <div style={{ height: BOTTOM_HEIGHT, flex: 'none', padding: '12px 16px 16px' }}>
        <Card
          size="small"
          style={{ height: '100%' }}
          styles={{ body: { paddingTop: 0, height: '100%', overflow: 'hidden' } }}
        >
          <Tabs
            size="small"
            items={[
              {
                key: 'timeline',
                label: '타임라인',
                children: (
                  <div style={{ height: BOTTOM_HEIGHT - 90, overflow: 'auto' }}>
                    <TimelineTab route={route} />
                  </div>
                ),
              },
              {
                key: 'decisions',
                label: `결정 기록 ${decisions.length ? decisions.length : ''}`,
                children: (
                  <div style={{ height: BOTTOM_HEIGHT - 90, overflow: 'auto' }}>
                    <DecisionLog
                      decisions={decisions}
                      onRevert={onRevert}
                      revertingId={revert.isPending ? (revert.variables ?? null) : null}
                      readOnly={readOnly}
                      loading={decisionsLoading}
                    />
                  </div>
                ),
              },
            ]}
          />
        </Card>
      </div>
    </>
  );
}
