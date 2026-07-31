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

본 프로젝트는 단순한 대시보드를 만드는 것을 넘어, **대규모 실시간 금융 데이터를 지연 없이 처리하고 배포하는 "모던 인프라 파이프라인"을 직접 경험하고 증명**하기 위해 시작되었습니다.
도커(Docker) 구동부터, **AWS EKS(쿠버네티스)** 와 **ArgoCD(GitOps)** 를 활용한 엔터프라이즈급 무중단 배포 실습까지 모두 담아낸 인프라 & Ops(DevOps) 학습용 프로젝트입니다.

---

## Approach

*   **이벤트 기반 아키텍처 (EDA)**: 데이터 수집 Worker와 제공자(API)를 분리하고, 그 사이에 카프카(Kafka)를 두어 트래픽 폭주 시에도 서버가 종료되지 않게 구현했습니다.
*   **12-Factor App (유연한 환경 변수)**: 애플리케이션의 '코드'와 '설정'을 완벽히 분리했습니다. 코드를 단 한 줄도 수정하지 않고도 로컬 환경과 EKS 클라우드 환경을 자유롭게 오갈 수 있도록 설계되었습니다.
*   **GitOps 지향**: 인프라의 상태를 깃허브(GitHub)를 통해 ArgoCD가 자동으로 배포하도록 구성했습니다.

---

## Architecture

1.  **Ingestion Worker**: 10초마다 야후/네이버 금융 API에서 국내외 12개 주요 지표 데이터를 수집.
2.  **Message Queue**: 수집된 데이터를 Kafka `market-ticks` 토픽으로 Produce하여 병목 방지 및 시스템 분리.
3.  **Backend API**: Fastify 기반 서버가 카프카를 실시간으로 Consume하여 브라우저에 WebSocket으로 100ms 이내에 데이터를 푸시. 무거운 쿼리는 Redis로 300초간 캐싱.
4.  **Database**: 수집된 모든 틱(Tick) 데이터는 PostgreSQL 기반의 시계열 최적화 DB인 TimescaleDB에 영구 보관.
5.  **Frontend UI**: React + Vite 기반의 다크모드 대시보드가 실시간 데이터에 맞춰 시각적으로 반응.

---

## Quick Start - 로컬 실행

지나가는 방문자나 코드를 클론(Clone)한 타 사용자들을 위해, **단 하나의 명령어로 10개의 서비스(DB, 캐시, 카프카, 백엔드, 프론트엔드 등)가 완벽하게 구동되도록 세팅**해 두었습니다. 번거로운 `.env` 설정조차 필요 없습니다. (스마트 폴백 로직 내장)

### 요구 사항
*   Docker 및 Docker Compose 설치

### 실행 명령어
```bash
# 레포지토리 클론 후 최상단 디렉토리에서 실행
docker-compose up -d --build
```
> 초기 기동 시 Kafka와 TimescaleDB가 켜지는 데 약 15~20초가 소요됩니다.

### 서비스 접속 포트
모든 컨테이너가 켜진 후, 브라우저에서 아래 주소로 접속하세요.

| 서비스 명 | 접속 주소 | 설명 / 계정 |
| :--- | :--- | :--- |
| **프론트엔드 대시보드** | `http://localhost:5173` | 메인 UI |
| **백엔드 API 서버** | `http://localhost:3001` | REST API 및 WebSocket 통신 포트 |
| **Grafana 모니터링** | `http://localhost:3000` | 인프라 감시 (초기 ID: `admin` / PW: `admin`) |

---

## 클라우드 배포 가이드라인 (AWS EKS & ArgoCD)

그전에 도커 허브에 push가 진행되어야 합니다.

<details>
<summary><b>EKS + ArgoCD 배포 가이드 펼치기</b></summary>
<br>

### 개요 & 인프라 철학: 왜 EKS와 ArgoCD인가?
*   **12-Factor App (환경변수)**: 코드를 고치지 않고 클라우드 환경에 맞춰 설정값만 유연하게 갈아 끼우도록 설계되었습니다.
*   **ArgoCD GitOps (Pull 기반)**: EKS 클러스터 내부의 ArgoCD 로봇이 깃허브를 주시하다가, 변경 사항을 감지하면 즉시 서버 상태를 동기화(Pull)하고 자가 치유(Self-healing)합니다.

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
> **배포 후 비용이 부담된다면 해당 가이드라인으로 배포를 중단하고 클러스터를 종료하세요.**
```bash
eksctl delete cluster --name kospi-eks-cluster --region ap-northeast-2
```
*   **검증**: 삭제 명령 완료 후, AWS 콘솔의 **[EKS]** 메뉴와 **[EC2]** 메뉴가 텅 비었는지 눈으로 직접 확인하세요.
</details>

---

*(참고: 클라우드 배포나 로컬 환경 커스텀을 원하실 경우에만 `frontend/.env.example` 및 `backend/.env.example` 파일을 복사하여 `.env`로 구성하시면 됩니다.)*
