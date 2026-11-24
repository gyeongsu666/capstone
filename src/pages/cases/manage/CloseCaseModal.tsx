import { useState } from 'react';
import { Alert, App, DatePicker, Input, Modal, Radio, Space } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import { useCloseCase } from '@/api/cases';
import { isApiError } from '@/api/client';
import type { CaseView, CloseReasonView } from '@/api/view';
import { closeReasonLabel } from '@/utils/format';

/** 사건 종료: 사유 입력, 실시간 감시 자동 해제, 이후 읽기 전용 (SYS02-011) */
export function CloseCaseModal({
  caseData,
  open,
  onClose,
}: {
  caseData: CaseView;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const close = useCloseCase(caseData.id);
  const [reason, setReason] = useState<CloseReasonView>('found');
  const [note, setNote] = useState('');
  const [foundAt, setFoundAt] = useState<Dayjs | null>(() => dayjs().second(0));
  const ready = note.trim().length > 0 && (reason !== 'found' || !!foundAt);

  return (
    <Modal
      title={`사건 종료 · ${caseData.title}`}
      open={open}
      onCancel={onClose}
      okText="사건 종료"
      okButtonProps={{ danger: true, loading: close.isPending, disabled: !ready }}
      cancelText="취소"
      destroyOnHidden
      onOk={() =>
        close.mutate(
          {
            reason,
            note: note.trim(),
            foundAt: foundAt?.format('YYYY-MM-DDTHH:mm:ssZ'),
            version: caseData.version,
          },
          {
            onSuccess: () => {
              message.success('사건을 종료했어요. 이제 읽기 전용이에요.');
              onClose();
            },
          },
        )
      }
    >
      <Space direction="vertical" size={16} style={{ width: '100%' }}>
        <Alert
          type="warning"
          showIcon
          message="종료하면 실시간 감시가 꺼지고, 판단·영상 추가 등 변경을 할 수 없어요."
          description="데이터는 보관 기간이 지나면 삭제돼요."
        />
        <div>
          <div style={{ marginBottom: 8 }}>종료 사유</div>
          <Radio.Group value={reason} onChange={(e) => setReason(e.target.value)}>
            {(Object.keys(closeReasonLabel) as CloseReasonView[]).map((k) => (
              <Radio key={k} value={k}>
                {closeReasonLabel[k]}
              </Radio>
            ))}
          </Radio.Group>
        </div>
        {reason === 'found' && (
          <div>
            <div style={{ marginBottom: 8 }}>발견 시각</div>
            <DatePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              value={foundAt}
              onChange={setFoundAt}
              disabledDate={(d) => d.isAfter(dayjs(), 'day')}
              style={{ width: '100%' }}
            />
          </div>
        )}
        <Input.TextArea
          rows={3}
          placeholder="종료 사유 (필수, 예: 도림제 산책로에서 발견)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
        />
        {close.isError && (
          <Alert
            type="error"
            showIcon
            message={
              isApiError(close.error, 'VERSION_CONFLICT')
                ? '다른 사람이 사건을 먼저 바꿨어요. 최신 내용을 다시 불러왔으니 확인 후 다시 종료하세요.'
                : isApiError(close.error)
                  ? close.error.detail
                  : '사건을 종료하지 못했어요.'
            }
          />
        )}
      </Space>
    </Modal>
  );
}
