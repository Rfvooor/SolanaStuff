# Use node:18 as base image
FROM node:18

# Set working directory inside the Docker image
WORKDIR /app

# Copy package.json and package-lock.json to working directory
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install

# Copy all backend source code to the working directory
COPY . .

# Expose port 3001
EXPOSE 3001

# Command to run your application
CMD ["node", "server.js"]
