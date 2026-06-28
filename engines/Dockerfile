FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

# 中文字体
RUN apt-get update && apt-get install -y \
    fonts-noto-cjk \
    fonts-wqy-zenhei \
    fonts-wqy-microhei \
    && rm -rf /var/lib/apt/lists/*

# 安装项目依赖
COPY package.json ./
RUN npm install --production

# 复制引擎代码
COPY common/ ./common/
COPY pdd/ ./pdd/
COPY server.js ./

# Playwright 官方镜像已有 pwuser
USER pwuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) })" || exit 1

CMD ["node", "server.js"]
