import { useEffect } from 'react';
import { Alert, App, Button, Card, Col, Form, InputNumber, Row, Space, Spin } from 'antd';
import { useSaveSettings, useSettingsForm, type SettingsFormInput } from '@/api/admin';
import { isApiError } from '@/api/client';
import type { PersonTypeView } from '@/api/view';
import { formatDateTime } from '@/utils/format';

const PERSON_TYPES: [PersonTypeView, string][] = [
  ['adult', '성인'],
  ['child', '어린이'],
  ['elderly', '노인'],
  ['other', '기타'],
];

/**
 * 시스템 설정: 보행 속도 · 검색·알림 기준 · 현재 위치 범위 (SYS01-006).
 * 서버는 임의 기본값을 넣지 않는다(D03). 비어 있는 값이 있으면 사건 등록·현재 위치 계산이 막힌다.
 */
export function SystemSettingsTab() {
  const [form] = Form.useForm<SettingsFormInput>();
  const { message } = App.useApp();
  const { data, isLoading } = useSettingsForm();
  const save = useSaveSettings();

  useEffect(() => {
    if (data) form.setFieldsValue(data);
  }, [data, form]);

  if (isLoading || !data) return <Spin />;

  const missing =
    data.similarityThresholdDefault === null ||
    data.alertHighThreshold === null ||
    PERSON_TYPES.some(([t]) => data.walkSpeeds[t].speedMps === null);

  const num = (
    name: (string | number)[],
    label: string,
    opts: { min: number; max: number; step: number; suffix?: string },
    extra?: string,
    required = true,
  ) => (
    <Form.Item
      name={name}
      label={label}
      extra={extra}
      rules={required ? [{ required: true, message: '값을 넣으세요.' }] : undefined}
    >
      <InputNumber {...opts} style={{ width: 160 }} />
    </Form.Item>
  );

  return (
    <Form<SettingsFormInput>
      form={form}
      layout="vertical"
      onFinish={(v) =>
        save.mutate(
          { ...v, version: data.version },
          {
            onSuccess: () => message.success('시스템 설정을 저장했어요. 새 계산부터 적용돼요.'),
          },
        )
      }
    >
      <Alert
        type={missing ? 'warning' : 'info'}
        showIcon
        style={{ marginBottom: 16 }}
        message={
          missing
            ? '아직 정하지 않은 값이 있어요. 모두 넣어야 사건 등록과 현재 위치 계산을 할 수 있어요.'
            : '기준값 숫자는 팀 논의 전 임시값이에요.'
        }
        description={`마지막 변경: ${formatDateTime(data.updatedAt)}`}
      />
      <Row gutter={16}>
        <Col span={8}>
          <Card size="small" title="보행 속도 (평소 / 최대)">
            {PERSON_TYPES.map(([t, label]) => (
              <Form.Item key={t} label={label} style={{ marginBottom: 12 }}>
                <Space.Compact>
                  <Form.Item
                    name={['walkSpeeds', t, 'speedMps']}
                    noStyle
                    rules={[{ required: true, message: '평소 속도' }]}
                  >
                    <InputNumber min={0.1} max={5} step={0.1} suffix="m/s" style={{ width: 110 }} />
                  </Form.Item>
                  <Form.Item
                    name={['walkSpeeds', t, 'maxSpeedMps']}
                    noStyle
                    dependencies={[['walkSpeeds', t, 'speedMps']]}
                    rules={[
                      { required: true, message: '최대 속도' },
                      ({ getFieldValue }) => ({
                        validator: (_, v) =>
                          v === null ||
                          v === undefined ||
                          v >= (getFieldValue(['walkSpeeds', t, 'speedMps']) ?? 0)
                            ? Promise.resolve()
                            : Promise.reject(new Error('최대 속도는 평소 속도 이상이에요.')),
                      }),
                    ]}
                  >
                    <InputNumber min={0.1} max={5} step={0.1} suffix="m/s" style={{ width: 110 }} />
                  </Form.Item>
                </Space.Compact>
              </Form.Item>
            ))}
            <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>
              최대 속도로 최소 이동 시간을 계산해, 지도에 없는 길로 빨리 간 경우도 후보에 넣어요.
            </div>
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="검색·알림 기준">
            {num(
              ['similarityThresholdDefault'],
              '유사도 기준 기본값',
              { min: 0, max: 1, step: 0.01 },
              '새 사건에 적용돼요. 사건마다 바꿀 수 있어요.',
            )}
            {num(
              ['alertHighThreshold'],
              '출현 알림 높음 기준',
              { min: 0, max: 1, step: 0.01 },
              '이 값 이상이면 높음, 사건 유사도 기준 이상이면 중간. 기본값보다 커야 해요.',
            )}
            {num(
              ['outOfFilterThreshold'],
              '범위 밖 확인 기준',
              { min: 0, max: 1, step: 0.01 },
              '시간상 도달이 어려워도 이 값 이상이면 후보로 올려요. 비우면 쓰지 않아요. (백엔드 요청 R5)',
              false,
            )}
          </Card>
        </Col>
        <Col span={8}>
          <Card size="small" title="현재 위치 범위 3단계">
            {num(
              ['areaLevelRatios', 'high'],
              '높음 범위 비율',
              { min: 0.05, max: 0.95, step: 0.05 },
              '최대 이동 거리 대비 누적 비율',
            )}
            {num(
              ['areaLevelRatios', 'mid'],
              '중간 범위 비율',
              { min: 0.05, max: 0.95, step: 0.05 },
              '높음보다 크고 1보다 작아야 해요. 낮음은 1(전체)',
            )}
            {num(
              ['areaBufferM'],
              '길 양옆 폭',
              { min: 0, max: 500, step: 5, suffix: 'm' },
              '도보 길에서 양옆으로 넓힐 거리',
              false,
            )}
            {num(
              ['maxUploadMb'],
              '영상 업로드 최대 크기',
              { min: 1, max: 10_000, step: 100, suffix: 'MB' },
              undefined,
              false,
            )}
          </Card>
        </Col>
      </Row>
      {save.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 16 }}
          message={
            isApiError(save.error, 'VERSION_CONFLICT')
              ? '다른 관리자가 먼저 고쳤어요. 최신 값으로 바꿨으니 확인 후 다시 저장하세요.'
              : isApiError(save.error)
                ? save.error.detail
                : '저장하지 못했어요.'
          }
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
