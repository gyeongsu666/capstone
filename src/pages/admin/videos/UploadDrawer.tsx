import { App, Button, DatePicker, Drawer, Form, Select, Space, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import { useUploadVideo } from '@/api/admin';
import { isApiError } from '@/api/client';
import { useCameras } from '@/api/map';
import { CameraLayer, KakaoMap } from '@/map';
import { statusColor } from '@/theme';

interface UploadValues {
  cameraId: string;
  file: File;
  recordedAt: Dayjs;
}

interface UploadDrawerProps {
  open: boolean;
  onClose: () => void;
  /** 지도에서 고른 카메라로 시작 */
  initialCameraId?: string;
}

/** 영상 등록 폼(오른쪽): 카메라(작은 지도로 위치·방향 확인), 파일, 녹화 시작 시각 */
export function UploadDrawer({ open, onClose, initialCameraId }: UploadDrawerProps) {
  const [form] = Form.useForm<UploadValues>();
  const { message } = App.useApp();
  const upload = useUploadVideo();
  const { data: cameras = [] } = useCameras();
  const file = Form.useWatch('file', form);
  const cameraId = Form.useWatch('cameraId', form);
  const fixed = cameras.filter((c) => c.source === 'fixed');
  const selected = fixed.find((c) => c.id === cameraId);

  const close = () => {
    form.resetFields();
    upload.reset();
    onClose();
  };

  return (
    <Drawer
      title="영상 등록"
      open={open}
      onClose={close}
      width={440}
      destroyOnHidden
      footer={
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={close}>취소</Button>
          <Button type="primary" loading={upload.isPending} onClick={() => form.submit()}>
            올리고 분석 시작
          </Button>
        </Space>
      }
    >
      <Form<UploadValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
        initialValues={{ recordedAt: dayjs().startOf('hour'), cameraId: initialCameraId }}
        onFinish={(v) =>
          upload.mutate(
            {
              // 폼은 지도 노드 id로 고르고, 서버에는 camera_id로 보낸다
              cameraId: fixed.find((c) => c.id === v.cameraId)?.cameraId ?? v.cameraId,
              file: v.file,
              recordedAt: v.recordedAt.format('YYYY-MM-DDTHH:mm:ssZ'),
            },
            {
              onSuccess: (r) => {
                message.success(`영상 #${r.video_id} 분석을 시작했어요.`);
                r.warnings.forEach((w) => message.warning(w.message));
                close();
              },
            },
          )
        }
      >
        <Form.Item
          name="cameraId"
          label="카메라"
          rules={[{ required: true, message: '카메라를 고르세요.' }]}
        >
          <Select
            showSearch
            optionFilterProp="label"
            placeholder="고정 CCTV"
            options={fixed.map((c) => ({ value: c.id, label: `${c.code} ${c.name}` }))}
          />
        </Form.Item>
        <div
          style={{
            height: 200,
            marginTop: -12,
            marginBottom: 16,
            borderRadius: 6,
            overflow: 'hidden',
            border: '1px solid #d9d9d9',
          }}
        >
          <KakaoMap
            center={selected?.location}
            level={3}
            fitTo={selected ? undefined : fixed.map((c) => c.location)}
            bottomLeft={
              <span
                style={{
                  fontSize: 12,
                  padding: '2px 8px',
                  background: 'rgba(255,255,255,0.95)',
                  borderRadius: 4,
                }}
              >
                {selected
                  ? `${selected.code} ${selected.name} · ${selected.directionDeg}° 방향`
                  : '카메라를 고르거나 지도에서 누르세요'}
              </span>
            }
          >
            <CameraLayer
              cameras={fixed}
              selectedCameraId={cameraId}
              onSelect={(c) => form.setFieldValue('cameraId', c.id)}
            />
          </KakaoMap>
        </div>
        <Form.Item
          name="file"
          label="영상 파일"
          rules={[{ required: true, message: '영상 파일을 고르세요.' }]}
          valuePropName="file"
          getValueFromEvent={(e: { file: File }) => e.file}
          extra="2GB까지. 파일 이름에 fail이 들어가면 가짜 서버가 분석 실패로 처리해요."
        >
          <Upload accept="video/*" maxCount={1} beforeUpload={() => false} showUploadList={false}>
            <Button icon={<UploadOutlined />}>{file ? file.name : '파일 고르기'}</Button>
          </Upload>
        </Form.Item>
        <Form.Item
          name="recordedAt"
          label="녹화 시작 시각"
          rules={[{ required: true, message: '녹화 시작 시각을 고르세요.' }]}
        >
          <DatePicker
            showTime={{ format: 'HH:mm:ss' }}
            format="YYYY-MM-DD HH:mm:ss"
            style={{ width: '100%' }}
          />
        </Form.Item>
        {upload.isError && (
          <div style={{ color: statusColor.danger }}>
            {isApiError(upload.error) ? upload.error.detail : '영상을 올리지 못했어요.'}
          </div>
        )}
      </Form>
    </Drawer>
  );
}
