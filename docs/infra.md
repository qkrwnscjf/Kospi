# 📈 국내 증시 실시간 모니터링 대시보드 설계서

## 1. 프로젝트 개요
국내외 거시 경제, 환율, 그리고 핵심 섹터 모멘텀을 실시간으로 추적하여 자금의 흐름을 한눈에 파악할 수 있는 인터랙티브 금융 대시보드 구축 프로젝트. 실시간 스트리밍 처리와 시계열 데이터 조회를 모두 지원하는 람다 아키텍처(Lambda Architecture)를 채택함.

## 2. 기술 스택 (Tech Stack)
* **Frontend**: React, Tailwind CSS, Recharts
* **Backend**: Node.js (Fastify)
* **Data Pipeline**: Apache Kafka, Node.js Worker + Kafkajs (Ingestion)
* **Database**: TimescaleDB (PostgreSQL), Redis
* **Infrastructure**: Docker & Docker Compose

## 3. 프론트엔드 화면 설계 (UI/UX)
### 3.1. 레이아웃 구조
* **수직형 구조**: 상단 네비게이션 바(Header) + 하단 메인 콘텐츠 영역
* **헤더 컴포넌트**: 좌측 로고, 우측 4개 카테고리 탭 (가로 배치)
* **메인 컴포넌트**: 전체 너비를 활용한 Grid 레이아웃 (카테고리별 2x2 또는 4x2 차트 카드 균등 배치)

### 3.2. 카테고리별 지수 구성
1. **국내 전광판**: 코스피 지수, 코스닥 지수, VKOSPI(공포지수), 외국인/기관 당일 순매수 대금
2. **매크로 및 환율**: 원/달러 환율, 달러 인덱스, 미 10년물 국채 금리, 한 3년물 국고채 금리
3. **글로벌 연동**: S&P 500 / 나스닥 100, 필라델피아 반도체(SOX), WTI 원유, 국제 구리 선물
4. **국내 섹터 모멘텀**: KRX 반도체, KRX 2차전지, KRX 자동차, KRX 헬스케어, 코스피 200 중공업, KRX 인터넷, KRX 은행

### 3.3. 인터랙션 및 기능
* **타임프레임 전환**: 차트별 [실시간 / 1일 / 1주일 / 1개월 / 3개월 / 1년] 조회 기능
* **툴팁 제공**: 그래프 호버 시 특정 시점의 상세 수치 표시
* **상태 시각화**: 지수명, 현재가 표시 및 전일 대비 등락률 색상 적용 (상승 🟢 / 하락 🔴)
* **축(Axis) 표기**: X축(시간), Y축(단위 및 수치) 명시적 렌더링

## 4. 백엔드 및 데이터 파이프라인 아키텍처
본 시스템은 실시간 지연을 최소화하기 위해 스피드 레이어와 배치 레이어로 분리하여 처리함.

### 4.1. 파이프라인 데이터 플로우
1. **Ingestion**: Node.js 기반 워커(Worker) 데몬이 증권사 OpenAPI 및 웹소켓을 통해 원천 틱 데이터를 수집.
2. **Message Queue**: 수집된 데이터를 Apache Kafka 토픽(`market-ticks`)으로 발행(Produce).
3. **Speed Layer (실시간)**: Node.js (Fastify) 서버가 Kafka를 구독(Consume)하여 클라이언트(React)와 연결된 WebSocket(Socket.io)으로 데이터를 즉시 브로드캐스팅.
4. **Batch Layer (이력 조회)**: Kafka 데이터는 백그라운드 워커를 통해 TimescaleDB에 적재되며, 기간별 조회 요청 시 `Continuous Aggregations` 기능을 통해 리샘플링된 데이터를 Node.js REST API로 제공.

### 4.2. 클라이언트 - 서버 인터페이스
* **WebSocket**: 실시간 틱 데이터 스트리밍 (Socket.io `emit` & `on` 이벤트 처리)
* **REST API**: 과거 시계열 데이터 조회 (`GET /api/v1/market/history?ticker={id}&timeframe={tf}`)