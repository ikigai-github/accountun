FROM oven/bun:1.3.3-alpine

WORKDIR /app

# Copy root manifests 
COPY package.json bun.lock ./

# Copy your packages (adjust path if your layout differs)
COPY packages ./packages

# Install dependencies in production mode
RUN bun install --ci --production

# Environment defaults (can be overridden in Azure)
ENV NODE_ENV=production
ENV PORT=8787

# Expose the port your API listens on
EXPOSE 8787

# Start the API
# If your entrypoint differs, change this line accordingly.
CMD ["bun", "packages/api/index.ts"]
