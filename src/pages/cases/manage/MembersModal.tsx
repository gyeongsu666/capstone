import { useState } from 'react';
import { Alert, App, Modal, Select, Tag } from 'antd';
import { useSetCaseMembers } from '@/api/cases';
import { isApiError } from '@/api/client';
import { useUsersBrief } from '@/api/common';
import type { CaseView } from '@/api/view';

/** 공동 담당자 설정. 사건 등록자는 빼낼 수 없다 (SYS02-012) */
export function MembersModal({
  caseData,
  open,
  onClose,
}: {
  caseData: CaseView;
  open: boolean;
  onClose: () => void;
}) {
  const { message } = App.useApp();
  const save = useSetCaseMembers(caseData.id);
  const { data: users = [] } = useUsersBrief();
  const creatorId = caseData.createdBy.id;
  const [selected, setSelected] = useState<string[]>(() =>
    caseData.members.map((m) => m.id).filter((id) => id !== creatorId),
  );

  return (
    <Modal
      title="담당자 변경"
      open={open}
      onCancel={onClose}
      okText="저장"
      cancelText="취소"
      okButtonProps={{ loading: save.isPending }}
      destroyOnHidden
      onOk={() =>
        save.mutate([creatorId, ...selected], {
          onSuccess: () => {
            message.success('담당자를 바꿨어요.');
            onClose();
          },
        })
      }
    >
      <div style={{ marginBottom: 8 }}>
        사건 등록자 <Tag>{caseData.createdBy.name}</Tag>
        <span style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)' }}>(뺄 수 없음)</span>
      </div>
      <div style={{ marginBottom: 8 }}>공동 담당자</div>
      <Select
        mode="multiple"
        allowClear
        style={{ width: '100%' }}
        placeholder="이름으로 찾기"
        optionFilterProp="label"
        value={selected}
        onChange={setSelected}
        options={users
          .filter((u) => u.id !== creatorId)
          .map((u) => ({ value: u.id, label: u.name }))}
      />
      <div style={{ fontSize: 12, color: 'rgba(0,0,0,0.55)', marginTop: 8 }}>
        확인 요청과 출현 알림은 담당자 전원에게 보여요. 먼저 응답한 결과가 적용돼요.
      </div>
      {save.isError && (
        <Alert
          type="error"
          showIcon
          style={{ marginTop: 12 }}
          message={isApiError(save.error) ? save.error.detail : '담당자를 바꾸지 못했어요.'}
        />
      )}
    </Modal>
  );
}
