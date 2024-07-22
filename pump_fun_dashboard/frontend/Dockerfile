# Stage 1: Build the frontend
FROM node:18 AS frontend

WORKDIR /app/frontend

# Copy package.json and package-lock.json to work directory
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy frontend source code
COPY . .

# Build the frontend application
RUN npm run build

# Stage 2: Serve the frontend using a lightweight HTTP server
FROM node:18

WORKDIR /app

# Copy built frontend files from previous stage
COPY --from=frontend /app/frontend/build ./public

EXPOSE 3000

CMD ["npx", "serve", "-s", "public"]
