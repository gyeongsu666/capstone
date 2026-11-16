import { useEffect } from 'react';
import { Alert, App, Button, Card, Col, Form, InputNumber, Row, Space, Spin } from 'antd';
import { useSaveSettings, useSettingsForm } from '@/api/admin';
import { isApiError } from '@/api/client';
import type { SettingsFormView } from '@/api/view';
import { formatDateTime } from '@/utils/format';

type FormValues = Omit<SettingsFormView, 'updatedAt' | 'updatedByName'>;

/** 시스템 설정: 보행 속도 · 검색 기준 · 현재 위치 범위 (SYS01-006). 숫자는 팀 논의 전 임시값 */
export function SystemSettingsTab() {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const { data, isLoading } = useSettingsForm();
  const save = useSaveSettings();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  if (isLoading || !data) return <Spin />;

  const num = (
    name: (string | number)[],
    label: string,
    opts: { min: number; max: number; step: number; suffix?: string },
    extra?: string,
  ) => (
    <Form.Item
      name={name}
      label={label}
      extra={extra}
      rules={[{ required: true, message: '값을 넣으세요.' }]}
    >
      <InputNumber {...opts} style={{ width: 160 }} />
    </Form.Item>
  );

  return (
    <Form<FormValues>
      form={form}
      layout="vertical"
      onFinish={(v) =>
        save.mutate(v, {
          onSuccess: () => message.success('시스템 설정을 저장했어요. 새 검색부터 적용돼요.'),
        })
      }
    >
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="기준값 숫자는 팀 논의 전 임시값이에요."
        description={`마지막 변경: ${formatDateTime(data.updatedAt)} · ${data.updatedByName}`}
      />
      <Row gutter={16}>
        <Col span={8}>
          <Card size="small" title="보행 속도 (최대)">
            {num(['walkSpeedMps', 'adult'], '성인', { min: 0.1, max: 5, step: 0.1, suffix: 'm/s' })}
            {num(['walkSpeedMps', 'child'], '어린이', {
              min: 0.1,
              max: 5,
              step: 0.1,
              suffix: 'm/s',
            })}
            {num(['walkSpeedMps', 'elderly'], '노인', {
              min: 0.1,
              max: 5,
              step: 0.1,
              suffix: 'm/s',
            })}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="검색 기준">
            {num(
              ['similarityThresholdDefault'],
              '유사도 기준 기본값',
              { min: 0, max: 1, step: 0.01 },
              '사건마다 바꿀 수 있어요.',
            )}
            {num(
              ['confirmRequestThreshold'],
              '확인 요청 기준',
              { min: 0, max: 1, step: 0.01 },
              '이 값 이하면 담당자에게 확인을 요청해요.',
            )}
            {num(
              ['filterMarginMinutes'],
              '필터 여유 시간',
              { min: 0, max: 120, step: 1, suffix: '분' },
              '도보 이동 시간에 더하는 여유',
            )}
            {num(
              ['outOfFilterThreshold'],
              '범위 밖 확인 기준',
              { min: 0, max: 1, step: 0.01 },
              '도보 범위 밖이어도 이 값 이상이면 후보로 올려요.',
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="현재 위치 범위 3단계">
            {num(
              ['areaLevelBounds', 'high'],
              '높음 기준',
              { min: 0, max: 1, step: 0.05 },
              '이동 가능 거리 대비 비율(임시)',
            )}
            {num(
              ['areaLevelBounds', 'mid'],
              '중간 기준',
              { min: 0, max: 1, step: 0.05 },
              '높음보다 커야 해요.',
            )}
          </Card>
        </Col>
      </Row>
      {save.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message={isApiError(save.error) ? save.error.detail : '저장하지 못했어요.'}
        />
      )}
      <Space style={{ marginTop: 16 }}>
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          저장
        </Button>
        <Button onClick={() => form.setFieldsValue(data)}>되돌리기</Button>
      </Space>
    </Form>
  );
}
