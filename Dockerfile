FROM node:20-alpine

WORKDIR /app

# Copy dependency files first
COPY package.json package-lock.json* ./

# Install all deps
RUN npm ci

# Copy source code
COPY . .

# Build app to dist
RUN npm run build

# Expose port (default 3000, can be overridden by env)
EXPOSE 3000

# Set environment to production
ENV NODE_ENV=production

# Run the application
CMD ["npm", "run", "start"]
