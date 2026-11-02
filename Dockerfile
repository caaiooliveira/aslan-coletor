# Imagem oficial do Playwright já traz o Chromium e as dependências.
FROM mcr.microsoft.com/playwright:v1.47.2-jammy
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
CMD ["node", "src/index.mjs", "--loop"]
