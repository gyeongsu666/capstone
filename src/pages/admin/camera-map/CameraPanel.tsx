import { useEffect } from 'react';
import {
  Alert,
  App,
  Button,
  Card,
  Form,
  Input,
  InputNumber,
  Popconfirm,
  Slider,
  Space,
  Tag,
} from 'antd';
import { AimOutlined, DeleteOutlined } from '@ant-design/icons';
import { useCreateCamera, useDeleteCamera, useUpdateCamera, type CameraInput } from '@/api/admin';
import { isApiError } from '@/api/client';
import type { CameraView, LatLngView } from '@/api/view';
import { CameraVideos } from '@/pages/admin/camera-map/CameraVideos';

interface CameraPanelProps {
  /** 고친 카메라. null이면 새 카메라 */
  camera: CameraView | null;
  /** 지도에서 찍은 위치(새 카메라·위치 옮기기) */
  draftLocation: LatLngView | null;
  /** 위치 찍기 모드인지 */
  picking: boolean;
  onPickLocation: () => void;
  onDone: (camera?: CameraView) => void;
  /** 촬영 방향 미리보기 */
  onPreview: (v: { directionDeg: number; fovDeg: number }) => void;
}

type FormValues = Omit<CameraInput, 'location'>;

/** 카메라 등록·수정: 위치는 지도에서 찍고, 방향·화각은 슬라이더 */
export function CameraPanel({
  camera,
  draftLocation,
  picking,
  onPickLocation,
  onDone,
  onPreview,
}: CameraPanelProps) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const create = useCreateCamera();
  const update = useUpdateCamera();
  const remove = useDeleteCamera();
  const isNew = camera === null;
  const location = draftLocation ?? camera?.location ?? null;
  const direction = Form.useWatch('directionDeg', form);
  const fov = Form.useWatch('fovDeg', form);

  useEffect(() => {
    form.setFieldsValue({
      code: camera?.code ?? '',
      name: camera?.name ?? '',
      directionDeg: camera?.directionDeg ?? 0,
      fovDeg: camera?.fovDeg ?? 90,
    });
  }, [camera, form]);

  useEffect(() => {
    if (typeof direction === 'number' && typeof fov === 'number')
      onPreview({ directionDeg: direction, fovDeg: fov });
  }, [direction, fov, onPreview]);

  const error = create.error ?? update.error ?? remove.error;

  const submit = (v: FormValues) => {
    if (!location) {
      message.warning('지도에서 위치를 찍으세요.');
      return;
    }
    const body = { ...v, code: v.code.trim(), name: v.name.trim(), location };
    if (isNew) {
      create.mutate(body, {
        onSuccess: (c) => {
          message.success(`${c.code} 카메라를 등록했어요. 도보 경로는 "다시 계산"으로 반영하세요.`);
          onDone();
        },
      });
    } else {
      update.mutate(
        { id: camera.id, ...body },
        {
          onSuccess: () => {
            message.success(`${body.code} 카메라를 고쳤어요.`);
            onDone();
          },
        },
      );
    }
  };

  return (
    <Card
      size="small"
      title={
        <span>
          {isNew ? '새 카메라' : '선택한 카메라'} {!isNew && <Tag color="blue">{camera.code}</Tag>}
        </span>
      }
      extra={
        <Button size="small" type="text" onClick={() => onDone()}>
          닫기
        </Button>
      }
    >
      <Form<FormValues>
        form={form}
        layout="horizontal"
        labelCol={{ span: 6 }}
        onFinish={submit}
        size="small"
      >
        <Form.Item name="code" label="코드" rules={[{ required: true, message: '예: C13' }]}>
          <Input placeholder="C13" maxLength={10} />
        </Form.Item>
        <Form.Item
          name="name"
          label="이름"
          rules={[{ required: true, whitespace: true, message: '설치 장소 이름' }]}
        >
          <Input placeholder="도서관 앞" maxLength={50} />
        </Form.Item>
        <Form.Item label="좌표" required>
          <Space>
            <span className="num" style={{ fontSize: 13 }}>
              {location
                ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
                : '지도에서 찍으세요'}
            </span>
            <Button
              size="small"
              icon={<AimOutlined />}
              type={picking ? 'primary' : 'default'}
              onClick={onPickLocation}
            >
              {picking ? '지도를 누르세요' : isNew ? '위치 찍기' : '위치 옮기기'}
            </Button>
          </Space>
        </Form.Item>
        <Form.Item name="directionDeg" label="방향">
          <Slider
            min={0}
            max={359}
            marks={{ 0: '북', 90: '동', 180: '남', 270: '서' }}
            tooltip={{ formatter: (v) => `${v}°` }}
          />
        </Form.Item>
        <Form.Item name="fovDeg" label="화각">
          <InputNumber min={10} max={180} suffix="°" style={{ width: 110 }} />
        </Form.Item>
        {!isNew && <CameraVideos cameraId={camera.id} />}
        {error && (
          <Alert
            type="error"
            showIcon
            style={{ marginBottom: 12 }}
            message={isApiError(error) ? error.detail : '저장하지 못했어요.'}
          />
        )}
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          {!isNew ? (
            <Popconfirm
              title={`${camera.code} 카메라를 지울까요?`}
              description="등록된 영상이 있으면 지울 수 없어요."
              okText="삭제"
              okButtonProps={{ danger: true }}
              cancelText="취소"
              onConfirm={() =>
                remove.mutate(camera.id, {
                  onSuccess: () => {
                    message.success(`${camera.code} 카메라를 지웠어요.`);
                    onDone();
                  },
                })
              }
            >
              <Button danger icon={<DeleteOutlined />} loading={remove.isPending}>
                삭제
              </Button>
            </Popconfirm>
          ) : (
            <span />
          )}
          <Button type="primary" htmlType="submit" loading={create.isPending || update.isPending}>
            {isNew ? '등록' : '저장'}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
