// 서버 호출은 src/api에서만 한다. client·타입·엔드포인트·훅은 3단계부터 채운다.
export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '/api';
