FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
WORKDIR /srv
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
COPY public ./public
ENV DATA_DIR=/data
CMD ["node", "server.js"]
