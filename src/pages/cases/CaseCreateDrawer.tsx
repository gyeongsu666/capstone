import { useNavigate } from 'react-router-dom';
import {
  App,
  Button,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useCreateCase } from '@/api/cases';
import { isApiError } from '@/api/client';
import { useSettings, useUsersBrief } from '@/api/common';
import { useCameras } from '@/api/map';
import type { LatLngView, WalkSpeedPresetView } from '@/api/view';
import { LocationPicker } from '@/map/LocationPicker';
import { useAuthStore } from '@/stores/auth';
import { walkSpeedViewLabel } from '@/utils/format';

interface FormValues {
  title: string;
  personName: string;
  age: number | null;
  description: string;
  missingAt: Dayjs;
  location: LatLngView;
  placeName: string;
  walkSpeed: WalkSpeedPresetView;
  memberIds: string[];
}

/** 사건 제목 기본 제안 */
const suggestTitle = (name: string) => (name.trim() ? `${name.trim()} 실종` : '');

/** 사건 등록(오른쪽 폼). 저장하면 동선 추적으로 이동. */
export function CaseCreateDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form] = Form.useForm<FormValues>();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const me = useAuthStore((s) => s.user);
  const create = useCreateCase();
  const { data: settings } = useSettings();
  const { data: users = [] } = useUsersBrief();
  const { data: cameras = [] } = useCameras();
  const location = Form.useWatch('location', form);

  const close = () => {
    form.resetFields();
    create.reset();
    onClose();
  };

  const submit = (v: FormValues) => {
    create.mutate(
      {
        title: v.title.trim(),
        personName: v.personName.trim(),
        age: v.age ?? null,
        description: v.description.trim(),
        missingAt: v.missingAt.format('YYYY-MM-DDTHH:mm:ssZ'),
        lastSeenPlace: { name: v.placeName?.trim() ?? '', location: v.location },
        personType: v.walkSpeed,
        memberIds: v.memberIds ?? [],
      },
      {
        onSuccess: ({ caseData, failedMemberIds }) => {
          message.success(`사건 "${caseData.title}"을 등록했어요.`);
          if (failedMemberIds.length) {
            const names = failedMemberIds
              .map((id) => users.find((u) => u.id === id)?.name ?? id)
              .join(', ');
            // 사건은 이미 만들어졌다. 다시 만들지 않고 담당자만 다시 추가하게 한다.
            message.warning(
              `${names}님을 담당자로 추가하지 못했어요. 사건 관리 > 담당자에서 다시 추가하세요.`,
              6,
            );
          }
          close();
          navigate(`/cases/${caseData.case_id}/tracking`);
        },
      },
    );
  };

  return (
    <Drawer
      title="사건 등록"
      open={open}
      onClose={close}
      width={480}
      destroyOnHidden
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={close}>취소</Button>
          <Button type="primary" loading={create.isPending} onClick={() => form.submit()}>
            등록하고 동선 추적 시작
          </Button>
        </Space>
      }
    >
      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
        onFinish={submit}
        initialValues={{ missingAt: dayjs().second(0), walkSpeed: 'adult', memberIds: [] }}
        onValuesChange={(changed) => {
          // 제목을 직접 고치기 전에는 "{이름} 실종"으로 채운다
          if ('personName' in changed && !form.isFieldTouched('title')) {
            form.setFieldValue('title', suggestTitle(changed.personName ?? ''));
          }
        }}
      >
        <Space.Compact block>
          <Form.Item
            name="personName"
            label="실종자 이름"
            rules={[{ required: true, whitespace: true, message: '이름을 입력하세요.' }]}
            style={{ flex: 1 }}
          >
            <Input placeholder="김OO" maxLength={50} />
          </Form.Item>
          <Form.Item name="age" label="나이" style={{ width: 120, marginLeft: 12 }}>
            <InputNumber min={0} max={150} precision={0} suffix="세" style={{ width: '100%' }} />
          </Form.Item>
        </Space.Compact>

        <Form.Item
          name="title"
          label="사건 제목"
          extra="이름을 넣으면 자동으로 채워져요. 고쳐도 돼요."
          rules={[{ required: true, whitespace: true, message: '사건 제목을 입력하세요.' }]}
        >
          <Input placeholder="김OO 실종" maxLength={100} />
        </Form.Item>

        <Form.Item
          name="description"
          label="인상착의"
          rules={[{ required: true, whitespace: true, message: '인상착의를 입력하세요.' }]}
        >
          <Input.TextArea rows={2} placeholder="빨간 상의, 남색 바지" maxLength={200} showCount />
        </Form.Item>

        <Form.Item
          name="missingAt"
          label="마지막 목격 시각"
          rules={[
            { required: true, message: '실종 시각을 고르세요.' },
            {
              validator: (_, v: Dayjs | undefined) =>
                v && v.isAfter(dayjs())
                  ? Promise.reject(new Error('지금보다 나중일 수 없어요.'))
                  : Promise.resolve(),
            },
          ]}
        >
          <DatePicker
            showTime={{ format: 'HH:mm' }}
            format="YYYY-MM-DD HH:mm"
            disabledDate={(d) => d.isAfter(dayjs(), 'day')}
            style={{ width: '100%' }}
          />
        </Form.Item>

        <Form.Item
          name="location"
          label="마지막 확인 장소"
          rules={[{ required: true, message: '지도에서 위치를 찍으세요.' }]}
          extra={
            location ? (
              <span className="num">
                {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
              </span>
            ) : undefined
          }
        >
          <LocationPicker
            value={location ?? null}
            onChange={(pos) => form.setFieldValue('location', pos)}
            cameras={cameras}
          />
        </Form.Item>
        <Form.Item name="placeName" style={{ marginTop: -12 }}>
          <Input placeholder="장소 이름 (선택, 예: 도림캠퍼스 정문)" maxLength={200} />
        </Form.Item>

        <Form.Item
          name="walkSpeed"
          label="사람 유형 (보행 속도)"
          extra="나이와 별개로 골라요. 이 유형의 보행 속도로 이동 범위를 계산해요."
        >
          <Radio.Group optionType="button" buttonStyle="solid">
            {(['adult', 'child', 'elderly', 'other'] as const).map((k) => (
              <Radio.Button key={k} value={k}>
                {walkSpeedViewLabel[k]}
                {settings && (
                  <span className="num" style={{ fontSize: 12, opacity: 0.75 }}>
                    {' '}
                    {settings.walkSpeedMps[k] === null ? '미정' : `${settings.walkSpeedMps[k]} m/s`}
                  </span>
                )}
              </Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>

        <Form.Item
          name="memberIds"
          label="공동 담당자"
          extra="등록하는 사람은 자동으로 담당자가 돼요."
        >
          <Select
            mode="multiple"
            allowClear
            placeholder="이름으로 찾기"
            optionFilterProp="label"
            options={users
              .filter((u) => u.id !== me?.id)
              .map((u) => ({ value: u.id, label: u.name }))}
          />
        </Form.Item>

        {create.isError && (
          <div style={{ color: '#dc2626' }}>
            {isApiError(create.error) ? create.error.detail : '사건을 등록하지 못했어요.'}
          </div>
        )}
      </Form>
    </Drawer>
  );
}
