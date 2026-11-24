import { useState } from 'react';
import { Button, DatePicker, Select, Space, Table, Tag, type TableProps } from 'antd';
import type { Dayjs } from 'dayjs';
import { useAllUsers, useAuditLogs } from '@/api/admin';
import { useAllCases } from '@/api/cases';
import type { AuditLogView } from '@/api/view';
import { statusColor } from '@/theme';
import { formatDateTime } from '@/utils/format';

/** 알려진 행동 이름(서버 action 문자열). 모르는 값은 그대로 보여 준다 */
const AUDIT_ACTION_LABEL: Record<string, string> = {
  login: '로그인',
  search: '검색',
  decision: '판단',
  revert: '번복',
  video_view: '영상 열람',
  video_upload: '영상 등록',
  case_create: '사건 등록',
  case_close: '사건 종료',
  account_change: '계정 변경',
  settings_change: '설정 변경',
  data_delete: '데이터 삭제',
};

/** 대상 자원 이름 */
const RESOURCE_LABEL: Record<string, string> = {
  session: '세션',
  case: '사건',
  decision: '판단',
  video: '영상',
  user: '계정',
  settings: '설정',
  retention: '데이터 보관',
};

/**
 * 이용 기록: 기간·사용자·사건·행동 필터 + 읽기 전용 표 (SYS01-008).
 * 서버 기록에는 설명 문장이 없고, 대상(자원)과 바뀐 필드·결과만 있다.
 */
export function AuditTab() {
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [userId, setUserId] = useState<string>();
  const [caseId, setCaseId] = useState<string>();
  const [action, setAction] = useState<string>();
  const { data: users = [] } = useAllUsers();
  const { data: cases = [] } = useAllCases();
  const { items, isLoading, hasNextPage, fetchNextPage, isFetchingNextPage } = useAuditLogs({
    from: range?.[0]?.startOf('day').format('YYYY-MM-DDTHH:mm:ssZ'),
    to: range?.[1]?.endOf('day').format('YYYY-MM-DDTHH:mm:ssZ'),
    userId,
    caseId,
    action,
  });
  const caseTitle = (id: string) => cases.find((c) => c.id === id)?.title;

  const columns: TableProps<AuditLogView>['columns'] = [
    {
      title: '시각',
      key: 'at',
      width: 120,
      render: (_, l) => <span className="num">{formatDateTime(l.at)}</span>,
    },
    { title: '사용자', dataIndex: 'userName', key: 'user', width: 100 },
    {
      title: '행동',
      key: 'action',
      width: 110,
      render: (_, l) => <Tag>{AUDIT_ACTION_LABEL[l.action] ?? l.action}</Tag>,
    },
    {
      title: '사건',
      key: 'case',
      width: 160,
      render: (_, l) =>
        l.caseId ? (
          <span>
            <span className="num" style={{ color: 'rgba(0,0,0,0.45)' }}>
              #{l.caseId}{' '}
            </span>
            {caseTitle(l.caseId) ?? ''}
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: '대상 · 바뀐 항목',
      key: 'target',
      render: (_, l) => {
        const [type, ...rest] = l.target.split(' ');
        return (
          <span>
            {RESOURCE_LABEL[type] ?? type}
            {rest.length ? ` ${rest.join(' ')}` : ''}
            {l.changedFields.length > 0 && (
              <span style={{ color: 'rgba(0,0,0,0.55)' }}> · {l.changedFields.join(', ')}</span>
            )}
          </span>
        );
      },
    },
    {
      title: '결과',
      key: 'result',
      width: 70,
      render: (_, l) =>
        l.result === 'success' ? (
          <Tag color="green">성공</Tag>
        ) : (
          <Tag color={statusColor.danger}>실패</Tag>
        ),
    },
  ];

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => setRange(v)}
          placeholder={['시작일', '종료일']}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="사용자"
          style={{ width: 140 }}
          value={userId}
          onChange={setUserId}
          options={users.map((u) => ({ value: u.id, label: u.name }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="사건"
          style={{ width: 160 }}
          value={caseId}
          onChange={setCaseId}
          options={cases.map((c) => ({ value: c.id, label: `#${c.id} ${c.title}` }))}
        />
        <Select
          allowClear
          placeholder="행동"
          style={{ width: 130 }}
          value={action}
          onChange={setAction}
          options={Object.entries(AUDIT_ACTION_LABEL).map(([value, label]) => ({ value, label }))}
        />
      </Space>
      <Table<AuditLogView>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={items}
        loading={isLoading}
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
        locale={{ emptyText: '조건에 맞는 기록이 없어요.' }}
      />
    </>
  );
}
