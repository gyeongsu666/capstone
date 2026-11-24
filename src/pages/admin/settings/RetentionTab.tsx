import { useEffect } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Checkbox,
  Col,
  Form,
  InputNumber,
  Row,
  Space,
  Spin,
  Table,
  Tag,
  type TableProps,
} from 'antd';
import {
  useDeletionCandidates,
  useRetention,
  useSaveRetention,
  type RetentionInput,
} from '@/api/admin';
import { isApiError } from '@/api/client';
import type { DeletionCandidateView } from '@/api/view';
import { statusColor } from '@/theme';
import { formatDateTime } from '@/utils/format';

const KIND_LABEL: Record<DeletionCandidateView['kind'], string> = {
  video: '녹화 영상',
  closed_case: '종료 사건',
  alert: '출현 알림',
  audit_log: '이용 기록',
};

const fmtBytes = (b: number) =>
  b >= 1e9 ? `${(b / 1e9).toFixed(1)}GB` : b >= 1e6 ? `${Math.round(b / 1e6)}MB` : `${b}B`;

type FormValues = Omit<RetentionInput, 'version'>;

/**
 * 데이터 보관: 보관 기간 설정 + 삭제 예정·보호 목록 (SYS01-009).
 * 이번 범위에서는 자동 삭제를 하지 않고 조회만 한다(백엔드 D02).
 */
export function RetentionTab() {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const { data, isLoading } = useRetention();
  const save = useSaveRetention();
  const {
    items: candidates,
    isLoading: candidatesLoading,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useDeletionCandidates();

  useEffect(() => {
    if (data) form.setFieldsValue({ ...data, applyToExisting: false });
  }, [data, form]);

  const columns: TableProps<DeletionCandidateView>['columns'] = [
    {
      title: '종류',
      key: 'kind',
      width: 100,
      render: (_, d) => <Tag>{KIND_LABEL[d.kind]}</Tag>,
    },
    {
      title: '대상',
      key: 'id',
      render: (_, d) => (
        <span className="num">
          #{d.id} · {fmtBytes(d.estimatedBytes)}
        </span>
      ),
    },
    {
      title: '보관 기한',
      key: 'until',
      width: 130,
      render: (_, d) => <span className="num">{formatDateTime(d.retainUntil)}</span>,
    },
    {
      title: '상태',
      key: 'state',
      width: 220,
      render: (_, d) =>
        d.blockedReasons.length ? (
          <span style={{ color: statusColor.pending }}>보호 · {d.blockedReasons.join(', ')}</span>
        ) : d.eligible ? (
          <Tag color="orange">삭제 가능(승인 필요)</Tag>
        ) : (
          <Tag>보관 중</Tag>
        ),
    },
  ];

  if (isLoading || !data) return <Spin />;

  const days = (name: keyof FormValues, label: string) => (
    <Col span={6}>
      <Form.Item name={name} label={label} extra="비우면 정하지 않음">
        <InputNumber min={1} max={3650} precision={0} suffix="일" style={{ width: '100%' }} />
      </Form.Item>
    </Col>
  );

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="보관 기간">
        <Form<FormValues>
          form={form}
          layout="vertical"
          onFinish={(v) =>
            save.mutate(
              {
                videoDays: v.videoDays ?? null,
                closedCaseDays: v.closedCaseDays ?? null,
                alertDays: v.alertDays ?? null,
                auditDays: v.auditDays ?? null,
                applyToExisting: !!v.applyToExisting,
                version: data.version,
              },
              { onSuccess: () => message.success('보관 기간을 저장했어요.') },
            )
          }
        >
          <Row gutter={16}>
            {days('closedCaseDays', '종료 사건(썸네일·특징·확인 기록)')}
            {days('videoDays', '녹화 영상 원본')}
            {days('alertDays', '출현 알림')}
            {days('auditDays', '이용 기록')}
          </Row>
          <Space align="center">
            <Form.Item name="applyToExisting" valuePropName="checked" noStyle>
              <Checkbox>이미 있는 데이터의 보관 기한도 다시 계산</Checkbox>
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={save.isPending}>
              저장
            </Button>
          </Space>
        </Form>
        {save.isError && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 12 }}
            message={
              isApiError(save.error, 'VERSION_CONFLICT')
                ? '다른 관리자가 먼저 바꿨어요. 최신 값으로 바꿨으니 확인 후 다시 저장하세요.'
                : isApiError(save.error)
                  ? save.error.detail
                  : '저장하지 못했어요.'
            }
          />
        )}
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 8 }}>
          기간이 지나도 자동으로 지우지 않아요. 아래에서 삭제 예정 대상을 확인만 할 수 있어요.
          마지막 변경 {formatDateTime(data.updatedAt)}.
        </div>
      </Card>
      <Card size="small" title="삭제 예정·보호 대상">
        <Table<DeletionCandidateView>
          size="small"
          rowKey={(d) => `${d.kind}-${d.id}`}
          columns={columns}
          dataSource={candidates}
          loading={candidatesLoading}
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
          locale={{ emptyText: '삭제 예정인 데이터가 없어요.' }}
        />
      </Card>
    </Space>
  );
}
