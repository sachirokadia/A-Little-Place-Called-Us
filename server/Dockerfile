FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund
COPY server/index.js ./
COPY postgres ./postgres
RUN mkdir -p uploads
EXPOSE 4000
CMD ["node", "index.js"]
