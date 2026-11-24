import { useState } from 'react';
import {
  Alert,
  App,
  Button,
  DatePicker,
  Divider,
  Form,
  Input,
  List,
  Modal,
  Progress,
  Slider,
  Space,
  Upload,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { useQueryClient } from '@tanstack/react-query';
import dayjs, { type Dayjs } from 'dayjs';
import { useAddCaseVideo, useCaseVideos } from '@/api/cases';
import { isApiError } from '@/api/client';
import { useTaskPolling } from '@/api/common';
import { useCameras } from '@/api/map';
import { queryKeys } from '@/api/queryKeys';
import type { CaseView, LatLngView } from '@/api/view';
import { AnalysisStatusBadge } from '@/components/StatusBadge';
import { LocationPicker } from '@/map/LocationPicker';
import { formatDateTime } from '@/utils/format';

interface FormValues {
  file: File;
  name: string;
  location: LatLngView;
  directionDeg: number;
  recordedAt: Dayjs;
}

/** 사건 영상 추가(사설 CCTV, 블랙박스 등). 이 사건에서만 쓰인다 (SYS02-009) */
export function CaseVideoModal({
  caseData,
  open,
  onClose,
}: {
  caseData: CaseView;
  open: boolean;
  onClose: () => void;
}) {
  const [form] = Form.useForm<FormValues>();
  const { message } = App.useApp();
  const qc = useQueryClient();
  const add = useAddCaseVideo(caseData.id);
  const [taskId, setTaskId] = useState<string | null>(null);
  const { data: videos = [] } = useCaseVideos(caseData.id, { enabled: open, poll: !!taskId });
  const { data: cameras = [] } = useCameras(caseData.id);
  const location = Form.useWatch('location', form);
  const direction = Form.useWatch('directionDeg', form);
  const file = Form.useWatch('file', form);

  const task = useTaskPolling(taskId, (t) => {
    qc.invalidateQueries({ queryKey: queryKeys.cases.videos(caseData.id) });
    qc.invalidateQueries({ queryKey: queryKeys.map.cameras(caseData.id) });
    if (t.status === 'done') message.success('사건 영상 분석이 끝났어요. 후보 검색에 포함돼요.');
    else message.error(`사건 영상 분석이 실패했어요. ${t.error ?? ''}`);
    setTaskId(null);
  });

  const submit = (v: FormValues) =>
    add.mutate(
      {
        file: v.file,
        name: v.name.trim(),
        location: v.location,
        directionDeg: v.directionDeg,
        recordedAt: v.recordedAt.format('YYYY-MM-DDTHH:mm:ssZ'),
      },
      {
        onSuccess: (res) => {
          message.info(`영상 #${res.video_id}을 올렸어요. 분석을 시작해요.`);
          setTaskId(res.task_id);
          form.resetFields();
        },
      },
    );

  return (
    <Modal
      title="사건 영상 추가"
      open={open}
      onCancel={onClose}
      width={640}
      destroyOnHidden
      footer={
        <Space>
          <Button onClick={onClose}>닫기</Button>
          <Button type="primary" loading={add.isPending} onClick={() => form.submit()}>
            올리고 분석 시작
          </Button>
        </Space>
      }
    >
      {videos.length > 0 && (
        <>
          <List
            size="small"
            header={<span style={{ fontWeight: 600 }}>이 사건의 영상 {videos.length}개</span>}
            dataSource={videos}
            renderItem={(v) => (
              <List.Item
                extra={<AnalysisStatusBadge status={v.status} progress={v.progress} small />}
              >
                <span className="num">
                  {v.cameraCode} {v.cameraName} · {v.label} · 녹화 {formatDateTime(v.recordedAt)}
                </span>
              </List.Item>
            )}
          />
          {task.data && task.data.status !== 'done' && task.data.status !== 'failed' && (
            <Progress percent={task.data.progress} size="small" status="active" />
          )}
          <Divider style={{ margin: '12px 0' }} />
        </>
      )}

      <Form<FormValues>
        form={form}
        layout="vertical"
        requiredMark="optional"
        onFinish={submit}
        initialValues={{ directionDeg: 0, recordedAt: dayjs(caseData.missingAt) }}
      >
        <Form.Item
          name="file"
          label="영상 파일"
          rules={[{ required: true, message: '영상 파일을 고르세요.' }]}
          valuePropName="file"
          getValueFromEvent={(e: { file: File }) => e.file}
        >
          <Upload accept="video/*" maxCount={1} beforeUpload={() => false} showUploadList={false}>
            <Button icon={<UploadOutlined />}>{file ? file.name : '파일 고르기'}</Button>
          </Upload>
        </Form.Item>
        <Form.Item
          name="name"
          label="촬영 장소 이름 (선택)"
          extra="비우면 '사건 영상 N'으로 정해져요."
        >
          <Input placeholder="예: OO편의점 앞" maxLength={50} />
        </Form.Item>
        <Form.Item
          name="location"
          label="촬영 위치"
          rules={[{ required: true, message: '지도에서 위치를 찍으세요.' }]}
        >
          <LocationPicker
            value={location ?? null}
            onChange={(pos) => form.setFieldValue('location', pos)}
            cameras={cameras}
            directionDeg={direction}
            height={220}
          />
        </Form.Item>
        <Form.Item name="directionDeg" label="촬영 방향(북=0°)" style={{ width: 280 }}>
          <Slider
            min={0}
            max={359}
            marks={{ 0: '북', 90: '동', 180: '남', 270: '서' }}
            tooltip={{ formatter: (v) => `${v}°` }}
          />
        </Form.Item>
        <Form.Item
          name="recordedAt"
          label="녹화 시작 시각"
          rules={[{ required: true, message: '녹화 시작 시각을 고르세요.' }]}
        >
          <DatePicker
            showTime={{ format: 'HH:mm:ss' }}
            format="YYYY-MM-DD HH:mm:ss"
            style={{ width: 260 }}
          />
        </Form.Item>
        {add.isError && (
          <Alert
            type="error"
            showIcon
            message={isApiError(add.error) ? add.error.detail : '영상을 올리지 못했어요.'}
          />
        )}
      </Form>
    </Modal>
  );
}
