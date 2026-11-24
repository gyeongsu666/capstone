import { useState } from 'react';
import {
  App,
  Button,
  Card,
  Input,
  List,
  Popconfirm,
  Segmented,
  Select,
  Slider,
  Space,
  Tag,
} from 'antd';
import { DeleteOutlined, PlusOutlined } from '@ant-design/icons';
import { useCreateDangerZone, useDeleteDangerZone, type DangerZoneInput } from '@/api/admin';
import { isApiError } from '@/api/client';
import type { DangerZoneView, LatLngView } from '@/api/view';
import { dangerKindLabel, severityLabel } from '@/utils/format';
import { emptyDraft, type ZoneDraft, type ZoneShape } from '@/pages/admin/camera-map/zoneDraft';

interface DangerZonePanelProps {
  zones: DangerZoneView[];
  draft: ZoneDraft | null;
  onDraftChange: (d: ZoneDraft | null) => void;
  /** 원을 다각형으로 바꾼 꼭짓점(저장용) */
  draftPolygon: LatLngView[];
}

/** 위험 지역: 목록 + 지도에서 다각형(점 찍기) 또는 원(중심 + 반지름)으로 등록 */
export function DangerZonePanel({
  zones,
  draft,
  onDraftChange,
  draftPolygon,
}: DangerZonePanelProps) {
  const { message } = App.useApp();
  const create = useCreateDangerZone();
  const remove = useDeleteDangerZone();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<DangerZoneInput['kind']>('water');
  const [severity, setSeverity] = useState<DangerZoneInput['severity']>('high');

  const ready = draftPolygon.length >= 3 && name.trim().length > 0;

  const save = () =>
    create.mutate(
      { name: name.trim(), kind, severity, polygon: draftPolygon },
      {
        onSuccess: () => {
          message.success(`위험 지역 "${name.trim()}"을 등록했어요.`);
          setName('');
          onDraftChange(null);
        },
        onError: (e) => message.error(isApiError(e) ? e.detail : '등록하지 못했어요.'),
      },
    );

  return (
    <Card
      size="small"
      title={`위험 지역 ${zones.length}곳`}
      extra={
        !draft && (
          <Button size="small" icon={<PlusOutlined />} onClick={() => onDraftChange(emptyDraft())}>
            추가
          </Button>
        )
      }
      styles={{ body: { padding: draft ? 12 : 0 } }}
    >
      {draft ? (
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Segmented<ZoneShape>
            block
            size="small"
            value={draft.shape}
            onChange={(shape) => onDraftChange({ ...emptyDraft(), shape })}
            options={[
              { label: '다각형', value: 'polygon' },
              { label: '원', value: 'circle' },
            ]}
          />
          <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.6)' }}>
            {draft.shape === 'polygon'
              ? `지도를 눌러 꼭짓점을 찍으세요 (${draft.points.length}개, 3개 이상)`
              : draft.center
                ? '반지름을 정하세요. 저장할 때 다각형으로 바꿔 보내요.'
                : '지도를 눌러 원의 중심을 찍으세요'}
          </div>
          {draft.shape === 'polygon' && draft.points.length > 0 && (
            <Space>
              <Button
                size="small"
                onClick={() => onDraftChange({ ...draft, points: draft.points.slice(0, -1) })}
              >
                마지막 점 지우기
              </Button>
              <Button size="small" onClick={() => onDraftChange({ ...draft, points: [] })}>
                다시 찍기
              </Button>
            </Space>
          )}
          {draft.shape === 'circle' && draft.center && (
            <Slider
              min={20}
              max={400}
              step={10}
              value={draft.radiusM}
              onChange={(radiusM) => onDraftChange({ ...draft, radiusM })}
              tooltip={{ formatter: (v) => `${v}m` }}
            />
          )}
          <Input
            placeholder="이름 (예: 공사장)"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={30}
          />
          <Space.Compact block>
            <Select<DangerZoneInput['kind']>
              size="small"
              value={kind}
              onChange={setKind}
              style={{ width: '60%' }}
              aria-label="종류"
              options={Object.entries(dangerKindLabel).map(([value, label]) => ({
                value: value as DangerZoneInput['kind'],
                label,
              }))}
            />
            <Select<DangerZoneInput['severity']>
              size="small"
              value={severity}
              onChange={setSeverity}
              style={{ width: '40%' }}
              aria-label="위험도"
              options={Object.entries(severityLabel).map(([value, label]) => ({
                value: value as DangerZoneInput['severity'],
                label: `위험도 ${label}`,
              }))}
            />
          </Space.Compact>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button size="small" onClick={() => onDraftChange(null)}>
              취소
            </Button>
            <Button
              size="small"
              type="primary"
              disabled={!ready}
              loading={create.isPending}
              onClick={save}
            >
              등록
            </Button>
          </Space>
        </Space>
      ) : (
        <List
          size="small"
          dataSource={zones}
          locale={{ emptyText: '위험 지역이 없어요.' }}
          renderItem={(z) => (
            <List.Item
              actions={[
                <Popconfirm
                  key="del"
                  title={`"${z.name}"을 지울까요?`}
                  okText="삭제"
                  okButtonProps={{ danger: true }}
                  cancelText="취소"
                  onConfirm={() =>
                    remove.mutate(z.id, {
                      onSuccess: () => message.success('위험 지역을 지웠어요.'),
                      onError: (e) => message.error(isApiError(e) ? e.detail : '지우지 못했어요.'),
                    })
                  }
                >
                  <Button
                    size="small"
                    type="text"
                    danger
                    icon={<DeleteOutlined />}
                    aria-label="삭제"
                  />
                </Popconfirm>,
              ]}
            >
              <Space>
                <span style={{ color: '#dc2626', fontWeight: 600 }}>{z.name}</span>
                <Tag>{dangerKindLabel[z.kind]}</Tag>
                <Tag color={z.severity === 'high' ? 'red' : undefined}>
                  위험도 {severityLabel[z.severity]}
                </Tag>
              </Space>
            </List.Item>
          )}
        />
      )}
    </Card>
  );
}
