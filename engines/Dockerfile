FROM node:20-bookworm-slim

WORKDIR /app

# 安装 Playwright 系统依赖 (不包括浏览器，下面单独安装)
RUN apt-get update && apt-get install -y \
    # Playwright 系统依赖
    libnss3 \
    libnspr4 \
    libatk1.0-0t64 \
    libatk-bridge2.0-0t64 \
    libcups2t64 \
    libdrm2 \
    libdbus-1-3 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    libgbm1 \
    libpango-1.0-0 \
    libcairo2 \
    libasound2t64 \
    # 中文字体
    fonts-noto-cjk \
    fonts-wqy-zenhei \
    fonts-wqy-microhei \
    # 工具
    curl \
    && rm -rf /var/lib/apt/lists/*

# 安装项目依赖
COPY package.json ./
RUN npm install --production

# 安装 Chromium 浏览器（shell 模式，无头）
RUN npx playwright install chromium-headless-shell

# 复制引擎代码
COPY common/ ./common/
COPY pdd/ ./pdd/
COPY server.js ./

# 创建非 root 用户并切换
RUN useradd -m -u 1001 pwuser && chown -R pwuser:pwuser /app
USER pwuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => { process.exit(r.statusCode === 200 ? 0 : 1) })" || exit 1

CMD ["node", "server.js"]
