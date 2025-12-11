# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package.json and install dependencies (including devDependencies for build)
COPY package.json ./
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Production Runtime
FROM node:20-alpine AS runner

WORKDIR /app

# Copy package.json and install only production dependencies
COPY package.json ./
RUN npm install --omit=dev

# Copy built assets and server script
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js ./

# Expose the internal port
EXPOSE 4173

# Start the server
CMD ["node", "server.js"]
