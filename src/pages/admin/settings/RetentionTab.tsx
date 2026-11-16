import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  InputNumber,
  Space,
  Spin,
  Table,
  Tag,
  type TableProps,
} from 'antd';
import { usePendingDeletions, useRetention, useSaveRetention } from '@/api/admin';
import { isApiError } from '@/api/client';
import type { PendingDeletionView, RetentionView } from '@/api/view';
import { formatDateTime } from '@/utils/format';

/** 데이터 보관: 보관 기간 설정 + 삭제 예정 목록 (SYS01-009) */
export function RetentionTab() {
  const [form] = Form.useForm<RetentionView>();
  const { message } = App.useApp();
  const { data, isLoading } = useRetention();
  const save = useSaveRetention();
  const [page, setPage] = useState(1);
  const { data: pending, isLoading: pendingLoading } = usePendingDeletions(page);

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  const columns: TableProps<PendingDeletionView>['columns'] = [
    {
      title: '종류',
      key: 'kind',
      width: 90,
      render: (_, p) => <Tag>{p.kind === 'case' ? '종료 사건' : '원본 영상'}</Tag>,
    },
    { title: '대상', dataIndex: 'label', key: 'label' },
    {
      title: '삭제 예정',
      key: 'deleteAt',
      width: 130,
      render: (_, p) => <span className="num">{formatDateTime(p.deleteAt)}</span>,
    },
  ];

  if (isLoading || !data) return <Spin />;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <Card size="small" title="보관 기간">
        <Form<RetentionView>
          form={form}
          layout="inline"
          onFinish={(v) =>
            save.mutate(v, { onSuccess: () => message.success('보관 기간을 저장했어요.') })
          }
        >
          <Form.Item
            name="closedCaseDays"
            label="종료 사건(썸네일·특징 벡터·확인 기록)"
            rules={[{ required: true, message: '일수를 넣으세요.' }]}
          >
            <InputNumber min={1} max={3650} precision={0} suffix="일" style={{ width: 120 }} />
          </Form.Item>
          <Form.Item
            name="rawVideoDays"
            label="녹화 영상 원본"
            rules={[{ required: true, message: '일수를 넣으세요.' }]}
          >
            <InputNumber min={1} max={3650} precision={0} suffix="일" style={{ width: 120 }} />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={save.isPending}>
            저장
          </Button>
        </Form>
        {save.isError && (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 12 }}
            message={isApiError(save.error) ? save.error.detail : '저장하지 못했어요.'}
          />
        )}
        <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 8 }}>
          기간이 지나면 자동으로 지우고, 지운 내역은 이용 기록에 남아요.
        </div>
      </Card>
      <Card size="small" title={`삭제 예정 ${pending?.total ?? ''}건`}>
        <Table<PendingDeletionView>
          size="small"
          rowKey={(p) => `${p.kind}-${p.id}`}
          columns={columns}
          dataSource={pending?.items}
          loading={pendingLoading}
          pagination={{
            current: page,
            pageSize: 10,
            total: pending?.total,
            onChange: setPage,
            hideOnSinglePage: true,
            showSizeChanger: false,
          }}
          locale={{ emptyText: '삭제 예정인 데이터가 없어요.' }}
        />
      </Card>
    </Space>
  );
}
