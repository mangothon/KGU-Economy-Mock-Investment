// ① Firebase 콘솔 > 프로젝트 설정 > 내 앱(웹)에서 복사한 값을 아래에 붙여 넣으세요.
//    (이 값은 공개되어도 괜찮은 값입니다. 보안은 firestore.rules가 담당합니다.)
export const firebaseConfig = {
  apiKey: "AIzaSyBbTAdWTNNRpCgjT4CEru9uDbHgtVYODyU",
  authDomain: "mock-investment-779ec.firebaseapp.com",
  projectId: "mock-investment-779ec",
  storageBucket: "mock-investment-779ec.firebasestorage.app",
  messagingSenderId: "184931592390",
  appId: "1:184931592390:web:2c4dff114b64f5d600cfc7"
};

// ② 게임 기본 설정
export const SEED = 1000000;        // 시드머니 (firestore.rules의 1000000과 같아야 합니다)
export const TOTAL_ROUNDS = 4;      // 총 라운드 수
export const DEFAULT_MINUTES = 3;   // 투자 접수 기본 시간(분)
export const MASK_NAMES = true;     // 스크린 순위표 이름 가리기 (이*준). 실명으로 보이려면 false

export const INDUSTRIES = ['반도체', '철강', '뷰티', '식료품'];

// ③ 회사와 초기 주가 (주가 변동률과 돌발 이슈는 여기에 넣지 않습니다 → 관리자 페이지에서 불러옵니다)
export const COMPANIES = [
  { code: 'BHB', name: '반해버려',     ind: '반도체', price: 52000 },
  { code: 'HSB', name: '하프소드바디', ind: '반도체', price: 31000 },
  { code: 'CGC', name: '철근철근',     ind: '철강',   price: 8000 },
  { code: 'PST', name: '포스틱',       ind: '철강',   price: 27000 },
  { code: 'YPG', name: '예쁘개',       ind: '뷰티',   price: 19000 },
  { code: 'BIT', name: '빛음',         ind: '뷰티',   price: 36000 },
  { code: 'BML', name: '불맛러버',     ind: '식료품', price: 24000 },
  { code: 'CJY', name: '청정이야',     ind: '식료품', price: 12000 }
];
