# yahoo-finance2가 Node 22 이상을 요구한다 (docs/Task_ORDER.md T-09, P-18)
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for caching
COPY package*.json ./
RUN npm install

# Copy source code and build
COPY . .
RUN npm run build

# Expose API port
EXPOSE 3001

# Default command (can be overridden by docker-compose for the worker)
# npm을 거치지 않고 node를 직접 실행해서 SIGTERM이 앱의 종료 처리로 바로 전달되게 한다 (docs/Task_ORDER.md T-28).
# npm run start와 같은 명령이다 (package.json의 start 스크립트).
CMD ["node", "dist/index.js"]
