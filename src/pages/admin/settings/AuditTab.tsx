import { useState } from 'react';
import { DatePicker, Select, Space, Table, Tag, type TableProps } from 'antd';
import type { Dayjs } from 'dayjs';
import { useAuditLogs, useUsers } from '@/api/admin';
import { useAllCases } from '@/api/cases';
import type { AuditActionView, AuditLogView } from '@/api/view';
import { formatDateTime } from '@/utils/format';

const AUDIT_ACTION_LABEL: Record<AuditActionView, string> = {
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

/** 이용 기록: 기간·사용자·사건·행동 필터 + 읽기 전용 표 (SYS01-008) */
export function AuditTab() {
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [userId, setUserId] = useState<string>();
  const [caseId, setCaseId] = useState<string>();
  const [action, setAction] = useState<AuditActionView>();
  const [page, setPage] = useState(1);
  const { data: users } = useUsers({ q: '', page: 1 });
  const { data: allCases } = useAllCases();
  const { data, isLoading } = useAuditLogs({
    from: range?.[0]?.startOf('day').format('YYYY-MM-DDTHH:mm:ssZ'),
    to: range?.[1]?.endOf('day').format('YYYY-MM-DDTHH:mm:ssZ'),
    userId,
    caseId,
    action,
    page,
  });
  const reset = () => setPage(1);
  const cases = allCases ?? [];

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
      render: (_, l) => <Tag>{AUDIT_ACTION_LABEL[l.action]}</Tag>,
    },
    {
      title: '사건',
      key: 'case',
      width: 100,
      render: (_, l) => <span className="num">{l.caseNo ?? '—'}</span>,
    },
    { title: '내용', dataIndex: 'detail', key: 'detail' },
  ];

  return (
    <>
      <Space wrap style={{ marginBottom: 12 }}>
        <DatePicker.RangePicker
          value={range}
          onChange={(v) => {
            setRange(v);
            reset();
          }}
          placeholder={['시작일', '종료일']}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="사용자"
          style={{ width: 140 }}
          value={userId}
          onChange={(v) => {
            setUserId(v);
            reset();
          }}
          options={users?.items.map((u) => ({ value: u.id, label: u.name }))}
        />
        <Select
          allowClear
          showSearch
          optionFilterProp="label"
          placeholder="사건"
          style={{ width: 160 }}
          value={caseId}
          onChange={(v) => {
            setCaseId(v);
            reset();
          }}
          options={cases.map((c) => ({ value: c.id, label: `#${c.id} ${c.title}` }))}
        />
        <Select
          allowClear
          placeholder="행동"
          style={{ width: 130 }}
          value={action}
          onChange={(v) => {
            setAction(v);
            reset();
          }}
          options={(Object.keys(AUDIT_ACTION_LABEL) as AuditActionView[]).map((a) => ({
            value: a,
            label: AUDIT_ACTION_LABEL[a],
          }))}
        />
      </Space>
      <Table<AuditLogView>
        size="small"
        rowKey="id"
        columns={columns}
        dataSource={data?.items}
        loading={isLoading}
        pagination={{
          current: page,
          pageSize: 20,
          total: data?.total,
          onChange: setPage,
          hideOnSinglePage: true,
          showSizeChanger: false,
        }}
        locale={{ emptyText: '조건에 맞는 기록이 없어요.' }}
      />
    </>
  );
}
