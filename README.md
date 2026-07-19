# KOSPI Insight Dashboard

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=flat&logo=fastify&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Apache_Kafka-231F20?style=flat&logo=apache-kafka&logoColor=white)
![TimescaleDB](https://img.shields.io/badge/TimescaleDB-FDB515?style=flat&logo=postgresql&logoColor=black)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![Grafana](https://img.shields.io/badge/Grafana-F46800?style=flat&logo=grafana&logoColor=white)

대규모 트래픽과 실시간 금융 데이터를 지연 없이 처리하기 위해 **Lambda 아키텍처(MSA)** 기반으로 설계된 클라우드 네이티브 실시간 주식 대시보드입니다.

## 핵심 기능 (Key Features)

- **실시간 웹소켓 스트리밍**: 카프카(Kafka) 버퍼링을 거친 가격 데이터가 Socket.io를 통해 프론트엔드로 100ms 이내에 푸시됩니다.
- **캐싱 기반 초고속 렌더링**: 무거운 과거 차트 데이터는 외부 API를 매번 호출하지 않고 Redis에 300초간 캐싱하여 즉각적으로 반환합니다.
- **시계열 아카이빙**: 수집된 모든 틱(Tick) 데이터는 PostgreSQL 기반의 시계열 최적화 DB인 TimescaleDB에 영구적으로 압축 보관됩니다.
- **무중단 운영 모니터링**: Prometheus와 Grafana를 통한 카프카 트래픽 및 컨테이너 헬스체크 대시보드가 내장되어 있습니다.

## 아키텍처 (Architecture)

1. **Ingestion Worker**: 10초마다 야후/네이버 금융 API에서 국내외 12개 주요 지표 데이터를 수집.
2. **Message Queue**: 수집된 데이터를 Kafka `market-ticks` 토픽으로 Produce하여 병목 방지 및 시스템 분리.
3. **Backend API**: 카프카를 실시간으로 Consume하여 브라우저에 WebSocket으로 전달하고, DB/Redis와 통신하여 REST API를 제공.
4. **Frontend UI**: React + Vite 기반의 다크모드 대시보드가 실시간 데이터에 맞춰 시각적으로 깜빡이며 반응 (Nginx 서빙).

> 💡 더 자세한 내부 구조와 클라우드 확장 전략은 아래 문서를 참고하세요.
> * [파이프라인 상세 명세서 (docs/architecture.md)](docs/architecture.md)
> * [클라우드 네이티브 전환 전략 (docs/cloud.md)](docs/cloud.md)

---

## 시작하기 (Quick Start)

이 프로젝트는 100% Docker로 컨테이너화되어 있습니다. 복잡한 환경 설정이나 패키지 설치 없이 명령어 단 한 줄로 **10개의 서비스(DB, 캐시, 카프카, 백엔드, 프론트엔드, 모니터링 등)**가 자동으로 기동됩니다.

### 요구 사항
- Docker 및 Docker Compose 설치

### 1. 프로젝트 실행
```bash
# 레포지토리 클론 후 최상단 디렉토리에서 실행
docker-compose up -d --build
```
> 초기 기동 시 Kafka와 TimescaleDB가 켜지는 데 약 15~20초가 소요됩니다.

### 2. 서비스 접속 포트 안내

모든 컨테이너가 켜진 후, 브라우저에서 아래 주소로 접속하세요.

| 서비스 명 | 접속 주소 | 설명 / 계정 |
| :--- | :--- | :--- |
| **프론트엔드 대시보드** | `http://localhost:5173` | 메인 UI |
| **백엔드 API 서버** | `http://localhost:3001` | REST API 및 WebSocket 통신 포트 |
| **Grafana 모니터링** | `http://localhost:3000` | 인프라 감시 (초기 ID: `admin` / PW: `admin`) |

## 개발 환경 및 로컬 실행 (Local Development)

도커를 사용하지 않고 직접 코드를 수정하며 개발할 경우 아래 명령어를 참고하세요. (단, Kafka와 DB 도커는 띄워져 있어야 합니다.)

```bash
# 백엔드 서버 실행
cd backend
npm install
npm run dev

# 프론트엔드 서버 실행
cd frontend
npm install
npm run dev
```

## 라이선스 (License)

This project is licensed under the MIT License - see the LICENSE file for details.
