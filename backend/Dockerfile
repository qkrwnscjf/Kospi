FROM node:20-alpine

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
