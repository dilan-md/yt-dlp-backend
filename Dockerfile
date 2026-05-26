FROM node:18-bullseye-slim

# Instalar Python 3 y FFmpeg (requeridos por yt-dlp)
RUN apt-get update && apt-get install -y python3 ffmpeg curl && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copiar dependencias
COPY package*.json ./
RUN npm install

# Copiar el resto del código
COPY . .

EXPOSE 3000

CMD ["npm", "start"]
