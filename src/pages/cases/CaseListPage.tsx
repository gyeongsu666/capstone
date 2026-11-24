import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Alert, Button, Card, Input, Table, Tabs, Tag, Tooltip, type TableProps } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { useCaseList } from '@/api/cases';
import { isApiError } from '@/api/client';
import type { CaseView } from '@/api/view';
import { TableFrame } from '@/app/layout/frames';
import { PageHeader } from '@/app/layout/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { CaseCreateDrawer } from '@/pages/cases/CaseCreateDrawer';
import { useIsAdmin } from '@/stores/auth';
import { statusColor } from '@/theme';
import { closeReasonLabel, formatDateTime, formatElapsedSince } from '@/utils/format';
import { useNow } from '@/utils/useNow';

/** 입력이 멈춘 뒤 값 반영 */
function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/** 사건 목록: 진행 중 / 종료 탭 + 검색 + 표. "사건 등록"은 오른쪽 폼. */
export function CaseListPage() {
  const navigate = useNavigate();
  const isAdmin = useIsAdmin();
  const now = useNow();
  const [closed, setClosed] = useState(false);
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useDebounced(search.trim());

  const {
    items,
    isLoading,
    isFetching,
    error,
    refetch,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useCaseList({ closed, q });

  const open = (c: CaseView) => navigate(`/cases/${c.id}/tracking`);

  const columns: TableProps<CaseView>['columns'] = [
    {
      title: '사건',
      key: 'title',
      width: 200,
      render: (_, c) => (
        <a
          onClick={(e) => {
            e.stopPropagation();
            open(c);
          }}
        >
          <span className="num" style={{ color: 'rgba(0,0,0,0.45)' }}>
            #{c.id}{' '}
          </span>
          {c.title}
        </a>
      ),
    },
    {
      title: '실종자',
      key: 'person',
      render: (_, c) => (
        <div>
          <div style={{ fontWeight: 600 }}>
            {c.personName}
            {c.age !== null && ` (${c.age}세)`}
          </div>
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>{c.description}</div>
        </div>
      ),
    },
    {
      title: '마지막 목격',
      key: 'missingAt',
      width: 120,
      render: (_, c) => <span className="num">{formatDateTime(c.missingAt)}</span>,
    },
    {
      title: closed ? '종료' : '경과 시간',
      key: 'elapsed',
      width: 150,
      render: (_, c) =>
        c.closed ? (
          <span className="num">
            {c.closedAt ? formatDateTime(c.closedAt) : ''}
            {c.closeReason && ` · ${closeReasonLabel[c.closeReason]}`}
          </span>
        ) : (
          <span className="num">{formatElapsedSince(c.missingAt, now)}</span>
        ),
    },
    {
      title: '확정·대기',
      key: 'counts',
      width: 170,
      render: (_, c) => (
        <span className="num" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: statusColor.confirmed }}>확정 {c.confirmedCount}</span>
          {c.pendingCount === null ? (
            // 최근 검색이 없거나 진행 중·낡음(R1: null은 0과 다르다)
            <Tooltip title="최근 검색 결과가 없거나 다시 검색해야 해요.">
              <span style={{ color: 'rgba(0,0,0,0.45)' }}>· 대기 —</span>
            </Tooltip>
          ) : c.pendingCount > 0 ? (
            <Tag color="orange" style={{ margin: 0 }}>
              확인 대기 {c.pendingCount}
            </Tag>
          ) : (
            <span style={{ color: 'rgba(0,0,0,0.45)' }}>· 대기 0</span>
          )}
        </span>
      ),
    },
    {
      title: '마지막 목격 장소',
      key: 'place',
      width: 150,
      render: (_, c) =>
        c.lastSeenPlace.name ?? <span style={{ color: 'rgba(0,0,0,0.45)' }}>—</span>,
    },
    {
      title: '담당자',
      key: 'members',
      width: 160,
      render: (_, c) => {
        const others = c.members.filter((m) => m.id !== c.createdBy.id);
        return (
          <Tooltip title={c.members.map((m) => m.name).join(', ')}>
            <span>
              {c.createdBy.name}
              {others.length > 0 && (
                <span style={{ color: 'rgba(0,0,0,0.55)' }}> 외 {others.length}명</span>
              )}
            </span>
          </Tooltip>
        );
      },
    },
  ];

  // 전체 개수는 서버가 주지 않는다(cursor 목록). 지금까지 받은 수만 쓴다.
  const loaded = items.length;

  return (
    <>
      <PageHeader
        title="사건 목록"
        summary={
          isLoading
            ? undefined
            : `${closed ? '종료' : '진행 중'}${isAdmin ? ' · 전체 사건' : ' · 맡은 사건'}`
        }
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            사건 등록
          </Button>
        }
      />
      <TableFrame>
        <Card styles={{ body: { paddingTop: 4 } }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <Tabs
              activeKey={closed ? 'closed' : 'open'}
              onChange={(k) => {
                setClosed(k === 'closed');
              }}
              items={[
                { key: 'open', label: '진행 중' },
                { key: 'closed', label: '종료' },
              ]}
              style={{ flex: 1 }}
            />
            <Input.Search
              allowClear
              placeholder="사건 제목·실종자 이름·번호"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ width: 260 }}
            />
          </div>

          {error ? (
            <Alert
              type="error"
              showIcon
              message="사건 목록을 불러오지 못했어요."
              description={isApiError(error) ? error.detail : undefined}
              action={<Button onClick={() => refetch()}>다시 시도</Button>}
            />
          ) : !isLoading && loaded === 0 && !q ? (
            closed ? (
              <EmptyState message="종료된 사건이 없어요." />
            ) : (
              <EmptyState
                message={
                  isAdmin ? '진행 중인 사건이 없어요.' : '맡은 사건이 없어요. 새 사건을 등록하세요.'
                }
                actionLabel="사건 등록"
                actionIcon={<PlusOutlined />}
                onAction={() => setCreating(true)}
              />
            )
          ) : (
            <Table<CaseView>
              rowKey="id"
              columns={columns}
              dataSource={items}
              loading={isLoading || (isFetching && !isFetchingNextPage)}
              onRow={(c) => ({ onClick: () => open(c), style: { cursor: 'pointer' } })}
              locale={{ emptyText: `"${q}"에 맞는 사건이 없어요.` }}
              pagination={false}
              footer={
                hasNextPage
                  ? () => (
                      <div style={{ textAlign: 'center' }}>
                        <Button loading={isFetchingNextPage} onClick={() => fetchNextPage()}>
                          더 보기
                        </Button>
                      </div>
                    )
                  : undefined
              }
            />
          )}
        </Card>
      </TableFrame>
      <CaseCreateDrawer open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
