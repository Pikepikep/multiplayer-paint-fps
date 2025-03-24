# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package files first
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application
COPY . .

# Create necessary directories if they don't exist
RUN mkdir -p client server

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 