import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useCase } from '@/api/cases';
import { isApiError } from '@/api/client';
import { NotFound } from '@/app/guards';
import { useCaseNavStore } from '@/stores/case';

/**
 * 사건 안의 화면(동선 추적, 현재 위치 수색) 공통.
 * 서버는 맡지 않은 사건도 404로 준다(존재 여부를 알리지 않음). 문구도 하나로 합친다.
 */
export function CaseLayout() {
  const { caseId } = useParams<{ caseId: string }>();
  const setLastCaseId = useCaseNavStore((s) => s.setLastCaseId);
  const { error } = useCase(caseId);

  const notFound = isApiError(error) && error.status === 404;

  useEffect(() => {
    if (!caseId) return;
    setLastCaseId(notFound ? null : caseId);
  }, [caseId, notFound, setLastCaseId]);

  if (notFound) return <NotFound message="사건을 찾을 수 없거나 접근 권한이 없습니다." />;
  return <Outlet />;
}
