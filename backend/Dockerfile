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
CMD ["npm", "run", "start"]
