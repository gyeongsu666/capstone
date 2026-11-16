import { Button, List } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useVideos } from '@/api/admin';
import { AnalysisStatusBadge } from '@/components/StatusBadge';
import { formatDateTime } from '@/utils/format';

/** 선택한 카메라의 녹화 영상(녹화 시각·상태) */
export function CameraVideos({ cameraId }: { cameraId: string }) {
  const navigate = useNavigate();
  const { data, isLoading } = useVideos({ cameraId, page: 1, size: 5 });
  const total = data?.total ?? 0;

  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>영상 {total}개</span>
        <Button size="small" type="link" onClick={() => navigate('/admin/videos')}>
          영상 관리
        </Button>
      </div>
      <List
        size="small"
        bordered
        loading={isLoading}
        dataSource={data?.items}
        locale={{ emptyText: '등록된 영상이 없어요.' }}
        renderItem={(v) => (
          <List.Item extra={<AnalysisStatusBadge status={v.status} progress={v.progress} small />}>
            <span className="num" style={{ fontSize: 12 }}>
              녹화 {formatDateTime(v.recordedAt)} · {v.fileName}
            </span>
          </List.Item>
        )}
      />
    </div>
  );
}
