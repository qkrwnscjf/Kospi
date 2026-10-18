# Stage 1: Build React/Vite app
# CI와 같은 Node 버전으로 빌드한다 (docs/Task_ORDER.md T-09)
FROM node:22-alpine as builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build
# 테스트가 실패하면 이미지가 만들어지지 않는다 (docs/Task_ORDER.md T-45). Node 22 내장 node:test와 타입 제거 실행, 새 의존성 없음
RUN npm test

# Stage 2: Serve with Nginx
FROM nginx:alpine

# Copy built assets from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Expose port 80
EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
