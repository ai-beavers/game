# The game and its multiplayer server in one container. Settings: see the top of server.ts.
#   docker build --build-arg GIT_SHA=$(git rev-parse HEAD) -t beaver .
#   docker run -p 5180:5180 -e PUBLIC_URL=https://beaver.example/ -e WORLD_FILE=/data/world.json -v beaver:/data beaver
FROM oven/bun:1.4.4-slim
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY . .
# The world file goes in /data (mount a volume there): owned by the user the server runs as.
RUN mkdir -p /data && chown bun:bun /data
ARG GIT_SHA=""
ENV NODE_ENV=production PORT=5180 GIT_SHA=$GIT_SHA
USER bun
EXPOSE 5180
CMD ["bun", "server.ts"]
