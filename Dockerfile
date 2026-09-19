# Production image for SunkenBot — Bun-only runtime.
FROM oven/bun:1 AS base
WORKDIR /app

# ffmpeg مطلوب لتقسيم الملفات الكبيرة
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# نسخ package.json و fca-nx (المكتبة المحلية) أولاً
COPY package.json bun.lock* ./
COPY fca-nx ./fca-nx

# تثبيت الحزم (fca-nx تُحلّ من ./fca-nx)
RUN bun install --production

# نسخ بقية الكود
COPY . .

ENV NODE_ENV=production
EXPOSE 10000

CMD ["bun", "run", "start"]
