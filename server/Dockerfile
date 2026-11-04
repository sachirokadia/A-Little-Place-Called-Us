FROM node:22-alpine
WORKDIR /app
COPY server/package.json server/package-lock.json* ./
RUN npm install --omit=dev --no-audit --no-fund || npm install --no-audit --no-fund
COPY server/index.js ./
COPY postgres ./postgres
# R3 fix: the server imports the board engine from ../src/lib/boardGame.ts
# in local layout; the Docker image has no src/ tree, so copy the single
# import-free engine file next to index.js and let loadBoardEngine() fall
# back to ./boardGame.ts.
COPY src/lib/boardGame.ts ./boardGame.ts
RUN mkdir -p uploads
EXPOSE 4000
CMD ["node", "index.js"]
