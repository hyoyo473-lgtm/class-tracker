FROM node:22-alpine
WORKDIR /app
COPY app/ ./
ENV NODE_ENV=production PORT=3000 DATA_DIR=/data TZ=Asia/Taipei
VOLUME /data
EXPOSE 3000
HEALTHCHECK --interval=60s --timeout=5s CMD node -e "fetch('http://localhost:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--disable-warning=ExperimentalWarning", "server.js"]
