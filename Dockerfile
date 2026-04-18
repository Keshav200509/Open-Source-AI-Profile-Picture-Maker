FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json backend/
RUN cd backend && npm ci --include=dev
COPY backend/tsconfig.json backend/
COPY backend/src/ backend/src/
RUN cd backend && npm run build

FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json backend/
RUN cd backend && npm ci --omit=dev
COPY --from=builder /app/backend/dist/ backend/dist/
RUN mkdir -p backend/temp
CMD ["node", "backend/dist/server.js"]
