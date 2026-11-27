// 백엔드 서버 타입. src/api/generated/schema.d.ts는 openapi/openapi.json에서 생성한다(npm run gen:api).
// openapi 1.1.0(docs 브랜치)에 R1~R8이 반영돼 덧붙임 타입은 없다. 명세가 바뀌면 openapi/openapi.json을 바꾸고 다시 생성한다.
import type { components } from '@/api/generated/schema';

export type S = components['schemas'];

export type ServerUser = S['User'];
export type ServerUserSummary = S['UserSummary'];
export type ServerRole = ServerUser['role'];
export type ErrorResponse = S['ErrorResponse'];
export type ErrorBody = S['ErrorBody'];
export type ServerLoginRequest = S['LoginRequest'];
export type ServerLoginResponse = S['LoginResponse'];
export type ServerPasswordChangeRequest = S['PasswordChangeRequest'];
export type ServerPasswordChangeResponse = S['PasswordChangeResponse'];
export type MessageResponse = S['MessageResponse'];

// R1~R7: openapi 1.1.0에 반영됨(docs 브랜치). 기존 이름은 화면 코드가 쓰므로 별칭으로 남긴다.
export type ServerMeResponse = S['LoginResponse'];
export type ServerCase = S['Case'];
export type ServerCasePage = S['CasePage'];
export type ServerCaseCreateRequest = S['CaseCreateRequest'];
export type ServerCasePatch = S['CasePatch'];
export type ServerPendingCount = S['PendingAlertCount'];
export type VideoStatusCounts = S['VideoStatusCounts'];
export type ServerVideoStats = S['VideoStats'];
export type ServerDecisionReverseRequest = S['DecisionReverseRequest'];
export type ServerSystemSettings = S['SystemSettings'];
export type ServerSystemSettingsPatch = S['SystemSettingsPatch'];
