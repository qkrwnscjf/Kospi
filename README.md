# KOSPI Insight Dashboard

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=flat&logo=typescript&logoColor=white)
![React](https://img.shields.io/badge/React-20232A?style=flat&logo=react&logoColor=61DAFB)
![Fastify](https://img.shields.io/badge/Fastify-000000?style=flat&logo=fastify&logoColor=white)
![Apache Kafka](https://img.shields.io/badge/Apache_Kafka-231F20?style=flat&logo=apache-kafka&logoColor=white)
![TimescaleDB](https://img.shields.io/badge/TimescaleDB-FDB515?style=flat&logo=postgresql&logoColor=black)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)
![AWS EKS](https://img.shields.io/badge/AWS_EKS-FF9900?style=flat&logo=amazonaws&logoColor=white)
![ArgoCD](https://img.shields.io/badge/ArgoCD-EF7B4D?style=flat&logo=argo&logoColor=white)

---

## Purpose

본 프로젝트는 단순한 대시보드를 만드는 것을 넘어, **실시간 금융 데이터를 지연 없이 처리하고 정확하게 저장·제공하는 "모던 데이터 파이프라인"을 직접 구축하고 수치로 검증**하기 위해 시작되었습니다.
도커(Docker) 구동부터 **AWS EKS(쿠버네티스)** 와 **ArgoCD(GitOps)** 를 활용한 배포 실습까지 담은 인프라 & Ops(DevOps) 학습용 프로젝트입니다.

---

## Approach

*   **이벤트 기반 아키텍처 (EDA)**: Kafka를 **유일한 데이터 출처**로 두고, 실시간 전송 경로와 DB 저장 경로가 Kafka를 각자 독립적으로 읽습니다. 한쪽이 느려지거나 멈춰도 다른 쪽에 영향을 주지 않습니다.
*   **측정 기반 개선**: 모든 변경은 채택 기준을 먼저 정한 뒤 Before/After를 측정해서, 효과가 확인된 것만 반영했습니다.
*   **12-Factor App**: 코드와 설정을 분리했습니다. 코드를 바꾸지 않고 로컬(Docker Compose)과 클러스터(EKS)를 오갈 수 있도록 모든 접속 정보는 환경변수로 받습니다.
*   **GitOps 지향**: 인프라 상태를 GitHub에 두고 ArgoCD가 동기화하는 구조를 목표로 합니다.

---

## Architecture

```
Yahoo Finance (10개 지표)
   │ 장중 5초 · 휴장 15초 · 장 마감 60초 (시장별 장 시간 + 소스의 장 상태로 판단)
   ▼
worker ── 값 검증 · 심볼 정규화 · 바뀐 값만 전송 ──▶ Kafka `market-ticks`
                                                       │
            ┌──────────────── 실시간 경로 ──────────────┴──────────── 저장 경로 ────────────┐
            ▼                                                                                ▼
   backend Gateway ── 먼저 전송 ──▶ Socket.io ──▶ 브라우저              db-sink ── 묶음 INSERT (중복 차단)
            └─ 그다음 Redis에 최신값 캐시 (기다리지 않음)                         ▼
                                                                    TimescaleDB
   backend History API ◀── 5분 · 1시간 · 1일 연속 집계 (1년 보관) ◀── 원본 tick (3시간 보관)

   잘못된 메시지 ──▶ Kafka `market-ticks.dlq` (격리 후 처리 계속)
   지표 ──▶ Prometheus ──▶ Grafana (대시보드 · 알림 규칙 자동 등록)
```

| 구성 요소 | 역할 |
| :--- | :--- |
| **worker** | Yahoo에서 10개 지표를 수집해 Kafka로 보냅니다. 요청 시간 제한, 실패 시 지수 백오프, 수집이 겹치지 않는 고정 주기 실행, 장 시간·휴장 판단에 따른 주기 조절 |
| **Kafka** | 실시간 tick 토픽(24시간 보관)과 잘못된 메시지를 격리하는 DLQ 토픽 |
| **backend (Fastify)** | Kafka를 읽어 WebSocket으로 즉시 전송(Gateway), 과거 그래프용 REST API(History API) |
| **db-sink** | Kafka를 따로 읽어 TimescaleDB에 묶음 저장. 저장에 성공한 뒤에만 읽은 위치를 기록해서 데이터를 잃지 않습니다 |
| **TimescaleDB** | 원본 tick은 3시간만 보관하고, 5분·1시간·1일 봉을 계층형 연속 집계로 1년 보관 |
| **Redis** | 최신값 캐시(새로 접속한 화면에 바로 표시), 과거 조회 캐시 |
| **frontend (React + Vite)** | 흑백 라이트·다크 테마 대시보드. 브라우저 탭 하나가 WebSocket 연결 하나를 공유합니다 |
| **Prometheus / Grafana** | 단계별 지연, 수집 성공률, 컨슈머 지연, DB 용량 대시보드와 알림 규칙 |

---

## 개선 결과 (로컬 측정값)

| 항목 | 개선 전 | 개선 후 |
| :--- | :--- | :--- |
| 화면 값의 평균 경과 시간 (수집 주기) | 5초 (10초 주기) | 2.5초 (5초 주기) |
| 수집 → WebSocket 전송 지연 (p50) | 약 50~66ms | 약 35~50ms |
| 과거 그래프 조회 (p50) | 138ms (외부 API 직접 호출) | 3ms (DB 집계 조회) |
| 집계 저장 용량 | 74.8MB | 5.7MB |
| Redis 장애 중 실시간 전송 | 사실상 중단 (분당 1건) | 정상 유지 (분당 120건) |
| 재시작 시 Kafka 재참여 | 약 12.6초 | 약 3.1초 |
| 잘못된 메시지 1건 | 실시간 전체 중단 | DLQ로 격리하고 처리 계속 |

수치는 개인 PC의 Docker Compose 환경에서 측정한 값이며, 환경에 따라 다를 수 있습니다.

---

## Quick Start - 로컬 실행

**단 하나의 명령어로 11개 서비스(DB, 캐시, 카프카, 백엔드, 수집기, DB 적재기, 프론트엔드, 모니터링)가 구동되도록 세팅**해 두었습니다. 별도의 `.env` 설정 없이 실행됩니다.

### 요구 사항
*   Docker 및 Docker Compose 설치

### 실행 명령어
```bash
# 레포지토리 클론 후 최상단 디렉토리에서 실행
docker-compose up -d --build

# 종료 (데이터는 볼륨에 유지)
docker-compose down
```
> 각 서비스는 의존 서비스가 준비(healthcheck)된 뒤 순서대로 시작합니다. 수집기와 DB 적재기는 첫 컨테이너가 뜬 뒤 약 20초 후에 시작됩니다.
> 처음 실행하면 DB 적재기가 최근 1년치 과거 데이터를 한 번 채웁니다(약 1~2분).

### 서비스 접속 주소

| 서비스 명 | 접속 주소 | 설명 |
| :--- | :--- | :--- |
| **프론트엔드 대시보드** | `http://localhost:5173` | 메인 UI (오른쪽 위 버튼으로 라이트·다크 전환) |
| **백엔드 API 서버** | `http://localhost:3001` | REST API 및 WebSocket |
| **Grafana 모니터링** | `http://localhost:3000` | "KOSPI Pipeline" 대시보드와 알림 규칙 자동 등록. 초기 계정은 Grafana 기본값(`admin` / `admin`)이며, 로컬 실습용입니다 |
| **Prometheus** | `http://localhost:9090` | 지표 원본 조회 |

### 테스트
```bash
cd backend && npm test     # 메시지 검증, 장 시간·휴장 판단, 심볼 허용 목록
cd frontend && npm test    # 차트 점 계산, 장 상태 배지, 숫자 표시
```
Node 22 내장 테스트 러너(`node:test`)를 사용합니다. Docker 이미지 빌드와 GitHub Actions CI에서도 자동으로 실행되며, 테스트가 실패하면 이미지가 만들어지지 않습니다.

---

## 데이터 안내

| 구분 | 내용 |
| :--- | :--- |
| 실시간 지표 (10개) | KOSPI, KOSDAQ, 원/달러, 달러 인덱스, 미 국채 10년물, S&P 500, 나스닥 100, 필라델피아 반도체, WTI, 구리 (Yahoo Finance) |
| 지연 시세 | 달러 인덱스·WTI·구리는 약 10분, 미 국채 10년물은 약 15분 늦은 시세이며, 화면에 "지연" 배지로 표시됩니다 |
| 준비 중 지표 (6개) | 코스피200 변동성지수, KRX 섹터 지수 5종은 수집을 준비하고 있어 "데이터 준비 중"으로 표시됩니다 |
| 과거 그래프 | 1일(5분 봉), 1주(1시간 봉), 1개월·3개월·1년(1일 봉). 최초 실행 시 채운 과거 데이터는 종가 기준입니다 |
| 장 상태 | 시장별 정규 거래 시간과 소스의 장 상태로 "장중 / 휴장 / 장 마감"을 표시합니다 |

Yahoo Finance는 공식 공개 API가 아니므로, 학습·개인 용도로만 사용하시기 바랍니다.

---

## 주요 설정 (환경변수)

| 변수 | 기본값 | 설명 |
| :--- | :--- | :--- |
| `POLLING_INTERVAL_MS` | 10000 (Compose에서는 5000) | 장중 수집 주기 |
| `HOLIDAY_POLLING_INTERVAL_MS` | 15000 | 장 시간이지만 소스가 휴장일 때의 주기 |
| `IDLE_POLLING_INTERVAL_MS` | 60000 | 모든 시장이 닫혔을 때의 주기 |
| `KAFKA_BROKERS` | `localhost:9092` | Compose 안에서는 `kafka:29092` |
| `REDIS_URL`, `DB_HOST` 등 | localhost 기본값 | 접속 정보는 모두 환경변수로 받습니다 |
| `VITE_SOCKET_URL`, `VITE_API_URL` | `http://localhost:3001` 기준 | 프론트엔드가 접속할 주소 |

---

## 클라우드 배포 가이드라인 (AWS EKS & ArgoCD)

> ⚠️ **`k8s/` 매니페스트는 현재 아키텍처(DB 적재기 분리, 테스트·healthcheck, 장 시간 기반 수집 등)에 맞게 아직 갱신되지 않았습니다.** 배포 전에 매니페스트 현행화와 비밀값 분리(Kubernetes Secret)가 필요합니다. 아래 내용은 클러스터 실습 절차입니다.

그전에 도커 허브에 push가 진행되어야 합니다.

<details>
<summary><b>EKS + ArgoCD 배포 가이드 펼치기</b></summary>
<br>

### 개요 & 인프라 철학: 왜 EKS와 ArgoCD인가?
*   **12-Factor App (환경변수)**: 코드를 고치지 않고 클라우드 환경에 맞춰 설정값만 유연하게 갈아 끼우도록 설계되었습니다.
*   **ArgoCD GitOps (Pull 기반)**: EKS 클러스터 내부의 ArgoCD가 깃허브를 주시하다가, 변경 사항을 감지하면 서버 상태를 동기화(Pull)하고 자가 치유(Self-healing)합니다.

### 사전 준비 (Mac OS 기준)
```bash
brew install awscli kubectl
brew tap weaveworks/tap && brew install weaveworks/tap/eksctl
aws configure # AWS IAM 액세스 키 입력 (리전: ap-northeast-2)
```

### EKS 클러스터 생성 명령어 (실습 시작)
```bash
eksctl create cluster \
  --name kospi-eks-cluster \
  --region ap-northeast-2 \
  --nodegroup-name standard-workers \
  --node-type t3.medium \
  --nodes 2 \
  --managed
```
**소요 시간**: **약 15분 ~ 20분**. 

### AWS 콘솔 실시간 관전 포인트 
1.  **[CloudFormation]**: 수많은 인프라 스택이 실시간으로 조립(`CREATE_IN_PROGRESS`)되는 광경 캡처.
2.  **[VPC]**: 자동 세팅된 퍼블릭/프라이빗 서브넷과 라우팅 테이블 구경.
3.  **[EC2]**: 워커 노드로 일할 `t3.medium` 서버 2대가 `Running` 중인 모습 캡처.
4.  **[EKS]**: 대시보드의 **[컴퓨팅]** 탭에서 노드 2대가 `Ready` 상태로 연결된 모습 확인.

### 쿠버네티스 조종 및 검증
```bash
kubectl get nodes
kubectl get pods -n kube-system
```

### ArgoCD 연동 
```bash
kubectl create namespace argocd
kubectl apply -n argocd -f https://raw.githubusercontent.com/argoproj/argo-cd/stable/manifests/install.yaml
kubectl get pods -n argocd
```

### 클러스터 종료 
> **EKS는 실행하는 동안 비용이 발생합니다. 실습이 끝나면 반드시 클러스터를 종료하세요.**
```bash
eksctl delete cluster --name kospi-eks-cluster --region ap-northeast-2
```
*   **검증**: 삭제 명령 완료 후, AWS 콘솔의 **[EKS]** 메뉴와 **[EC2]** 메뉴가 텅 비었는지 눈으로 직접 확인하세요.
</details>

---

*(참고: 로컬 환경을 커스텀하려면 `frontend/.env.example` 및 `backend/.env.example` 파일을 복사하여 `.env`로 구성하시면 됩니다. 실제 비밀번호나 키는 `.env`에만 두고 저장소에 올리지 마세요.)*
