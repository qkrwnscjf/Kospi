# yahoo-finance2가 Node 22 이상을 요구한다 (docs/Task_ORDER.md T-09, P-18)
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build
# 테스트가 실패하면 이미지가 만들어지지 않는다 (docs/Task_ORDER.md T-45). Node 내장 node:test + 기존 tsx, 새 의존성 없음
RUN npm test

# Expose API port
EXPOSE 3001

# Default command (can be overridden by docker-compose for the worker)
# npm을 거치지 않고 node를 직접 실행해서 SIGTERM이 앱의 종료 처리로 바로 전달되게 한다 (docs/Task_ORDER.md T-28).
# npm run start와 같은 명령이다 (package.json의 start 스크립트).
CMD ["node", "dist/index.js"]
