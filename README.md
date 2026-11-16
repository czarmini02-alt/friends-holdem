# 친구들과 홀덤

링크만 보내면 친구들과 함께 하는 온라인 텍사스 홀덤입니다. 칩은 게임용 가상 칩이에요.

- 최대 9명 · 테이블 코드로 방 나누기
- 카드는 서버만 알고, 각자에게 자기 패만 보냄
- 사이드팟 자동 계산 · 쇼다운 족보 판정
- 리바이, 손익 순위, 45초 시간 제한(지나면 자동 체크/폴드)
- 방장이 블라인드·시작 칩 변경 / 테이블 초기화

## 내 컴퓨터에서 실행해보기

Node.js 18 이상 필요.

```
npm install
npm start
```

브라우저에서 http://localhost:3000 접속.

## Render에 무료로 배포하기

1. GitHub에 새 저장소(repository)를 만들고, 이 폴더의 파일을 전부 올립니다.
   (`server.js`, `logic.js`, `package.json`, `public/index.html`, `README.md`, `.gitignore`)
2. https://render.com 에 GitHub 계정으로 가입/로그인합니다.
3. **New → Web Service** → 방금 만든 저장소를 선택합니다.
4. 설정:
   - Runtime: **Node**
   - Build Command: `npm install`
   - Start Command: `npm start`
   - Instance Type: **Free**
5. **Deploy** 를 누르고 몇 분 기다리면 `https://내-서비스-이름.onrender.com` 주소가 나옵니다.
6. 그 주소로 들어가서 입장한 뒤, 주소창 링크(`...#t-테이블코드`)를 친구에게 보내면 같은 테이블로 바로 들어옵니다.

## 알아둘 점

- 무료 플랜은 15분 동안 아무도 접속하지 않으면 서버가 잠들고, 다음 접속 때 깨어나는 데 1분쯤 걸립니다.
- 게임 상태는 서버 메모리에만 있어서, 서버가 잠들거나 재배포되면 칩이 초기화됩니다.
- 시간 제한은 환경변수 `TURN_MS`(밀리초)로 바꿀 수 있습니다. 예: `TURN_MS=60000`
