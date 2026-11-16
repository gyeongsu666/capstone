import { App, Button, Card, List, Progress } from 'antd';
import { useNavigate } from 'react-router-dom';
import { useRetryVideo, useVideos } from '@/api/admin';
import { isApiError } from '@/api/client';
import { AnalysisStatusBadge } from '@/components/StatusBadge';
import { statusColor } from '@/theme';

/** 영상 분석 현황(요약): 실패·진행 중·대기 영상만 */
export function VideoStatusPanel() {
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { data } = useVideos({ page: 1, size: 100 });
  const retry = useRetryVideo();
  const items = (data?.items ?? []).filter((v) => v.status !== 'done').slice(0, 5);

  return (
    <Card
      size="small"
      title="영상 분석 현황"
      extra={
        <Button size="small" type="link" onClick={() => navigate('/admin/videos')}>
          전체 보기
        </Button>
      }
      styles={{ body: { padding: 0 } }}
    >
      <List
        size="small"
        dataSource={items}
        locale={{ emptyText: '분석 중인 영상이 없어요.' }}
        renderItem={(v) => (
          <List.Item style={{ display: 'block' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span
                className="num"
                style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis' }}
              >
                {v.fileName}
              </span>
              <AnalysisStatusBadge status={v.status} progress={v.progress} small />
              {v.status === 'failed' && (
                <Button
                  size="small"
                  loading={retry.isPending && retry.variables === v.id}
                  onClick={() =>
                    retry.mutate(v.id, {
                      onSuccess: () => message.info(`${v.fileName} 재처리를 시작했어요.`),
                      onError: (e) =>
                        message.error(isApiError(e) ? e.detail : '재처리하지 못했어요.'),
                    })
                  }
                >
                  재처리
                </Button>
              )}
            </div>
            {v.status === 'processing' && (
              <Progress percent={v.progress} size="small" showInfo={false} />
            )}
            {v.status === 'failed' && v.errorMessage && (
              <div style={{ fontSize: 12, color: statusColor.danger }}>{v.errorMessage}</div>
            )}
          </List.Item>
        )}
      />
    </Card>
  );
}
