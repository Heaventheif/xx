# Production image for SunkenBot — Bun-only runtime.
# Render (and most Docker hosts) auto-detect this file: create a Web Service
# pointed at the repo, choose the "Docker" environment, and no separate
# Build/Start Command is needed (see README.md → "النشر على Render").
FROM oven/bun:1 AS base
WORKDIR /app

# ffmpeg/ffprobe are required at runtime to split large downloads into
# Messenger-sized parts (see src/utils/mediaSplitter.js). oven/bun's base
# image does not include them by default.
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies first so this layer is cached across code-only changes.
COPY package.json bun.lock* ./
RUN bun install --production

# Now copy the rest of the source.
COPY . .

ENV NODE_ENV=production
# Render injects PORT at runtime; webServer.js reads process.env.PORT and
# falls back to 10000 locally.
EXPOSE 10000

CMD ["bun", "run", "start"]
