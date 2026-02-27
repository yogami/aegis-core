FROM node:20-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm install

COPY . .
RUN npx tsc

FROM node:20-alpine AS runner

WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./package.json

# Phala dstack / Cloud execution entrypoint
EXPOSE 8000
CMD ["node", "dist/server.js"]
