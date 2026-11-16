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
  personName: string;
  age: number;
  description: string;
  missingAt: Dayjs;
  location: LatLngView;
  placeName: string;
  walkSpeed: WalkSpeedPresetView;
  memberIds: string[];
}

/** 나이로 보행 속도 추천: 13세 미만 어린이, 70세 이상 노인 */
const suggestWalkSpeed = (age: number): WalkSpeedPresetView =>
  age < 13 ? 'child' : age >= 70 ? 'elderly' : 'adult';

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
        personName: v.personName.trim(),
        age: v.age,
        description: v.description.trim(),
        missingAt: v.missingAt.format('YYYY-MM-DDTHH:mm:ssZ'),
        lastSeenPlace: { name: v.placeName.trim(), location: v.location },
        walkSpeed: v.walkSpeed,
        memberIds: v.memberIds ?? [],
      },
      {
        onSuccess: (c) => {
          message.success(`사건 ${c.case_no}을 등록했어요.`);
          close();
          navigate(`/cases/${c.id}/tracking`);
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
          // 보행 속도를 직접 고르기 전에는 나이에 맞춰 추천
          if (
            'age' in changed &&
            typeof changed.age === 'number' &&
            !form.isFieldTouched('walkSpeed')
          ) {
            form.setFieldValue('walkSpeed', suggestWalkSpeed(changed.age));
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
            <Input placeholder="김OO" maxLength={30} />
          </Form.Item>
          <Form.Item
            name="age"
            label="나이"
            rules={[{ required: true, message: '나이를 입력하세요.' }]}
            style={{ width: 120, marginLeft: 12 }}
          >
            <InputNumber min={0} max={120} suffix="세" style={{ width: '100%' }} />
          </Form.Item>
        </Space.Compact>

        <Form.Item
          name="description"
          label="인상착의"
          rules={[{ required: true, whitespace: true, message: '인상착의를 입력하세요.' }]}
        >
          <Input.TextArea rows={2} placeholder="빨간 상의, 남색 바지" maxLength={200} showCount />
        </Form.Item>

        <Form.Item
          name="missingAt"
          label="실종 시각"
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
        <Form.Item
          name="placeName"
          rules={[{ required: true, whitespace: true, message: '장소 이름을 입력하세요.' }]}
          style={{ marginTop: -12 }}
        >
          <Input placeholder="장소 이름 (예: 도림캠퍼스 정문)" maxLength={50} />
        </Form.Item>

        <Form.Item name="walkSpeed" label="보행 속도" extra="나이를 넣으면 자동으로 추천해요.">
          <Radio.Group optionType="button" buttonStyle="solid">
            {(['adult', 'child', 'elderly'] as const).map((k) => (
              <Radio.Button key={k} value={k}>
                {walkSpeedViewLabel[k]}
                {settings && (
                  <span className="num" style={{ fontSize: 12, opacity: 0.75 }}>
                    {' '}
                    {settings.walkSpeedMps[k]} m/s
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
