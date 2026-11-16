import { useEffect } from 'react';
import { Outlet, useParams } from 'react-router-dom';
import { useCase } from '@/api/cases';
import { isApiError } from '@/api/client';
import { Forbidden, NotFound } from '@/app/guards';
import { useCaseNavStore } from '@/stores/case';

/** 사건 안의 화면(동선 추적, 현재 위치 수색) 공통. 맡지 않은 사건(403)·없는 사건(404) 처리. */
export function CaseLayout() {
  const { caseId } = useParams<{ caseId: string }>();
  const setLastCaseId = useCaseNavStore((s) => s.setLastCaseId);
  const { error } = useCase(caseId);

  const forbidden = isApiError(error) && error.status === 403;
  const notFound = isApiError(error) && error.status === 404;

  useEffect(() => {
    if (!caseId) return;
    setLastCaseId(forbidden || notFound ? null : caseId);
  }, [caseId, forbidden, notFound, setLastCaseId]);

  if (forbidden) return <Forbidden message="맡은 사건만 볼 수 있어요." />;
  if (notFound) return <NotFound message="사건을 찾을 수 없어요." />;
  return <Outlet />;
}
