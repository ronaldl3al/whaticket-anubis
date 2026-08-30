# ─────────────────────────────────────────────
# Stage 1: Build backend
# ─────────────────────────────────────────────
FROM node:18-bullseye AS backend-builder

# Install Chrome for whatsapp-web.js / Puppeteer
RUN apt-get update && apt-get install -y wget gnupg ca-certificates postgresql-client git --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_BIN=/usr/bin/google-chrome-stable

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --legacy-peer-deps --no-audit
COPY backend/ ./
RUN npm run build

# ─────────────────────────────────────────────
# Stage 2: Build frontend
# ─────────────────────────────────────────────
FROM node:18-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install --legacy-peer-deps --no-audit
COPY frontend/ ./
ENV VITE_BACKEND_URL=/
RUN npm run build

# ─────────────────────────────────────────────
# Stage 3: Final image
# ─────────────────────────────────────────────
FROM node:18-bullseye

RUN apt-get update && apt-get install -y wget gnupg ca-certificates postgresql-client --no-install-recommends \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_BIN=/usr/bin/google-chrome-stable
ENV CHROME_ARGS=--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage
ENV NODE_ENV=production
ENV PORT=8080

WORKDIR /app/backend

# dist/ already contains compiled migrations, seeds, and config
COPY --from=backend-builder /app/backend/dist ./dist
COPY --from=backend-builder /app/backend/node_modules ./node_modules
COPY --from=backend-builder /app/backend/package.json ./package.json
COPY --from=backend-builder /app/backend/public ./public
COPY --from=backend-builder /app/backend/.sequelizerc ./.sequelizerc

# Frontend served from backend/public/frontend
COPY --from=frontend-builder /app/frontend/build ./public/frontend

# Create public dir for media uploads (whatsapp images, audio, etc.)
RUN mkdir -p ./public

EXPOSE 8080

CMD npx sequelize-cli db:migrate && node dist/server.js
