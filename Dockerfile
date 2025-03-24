# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Copy all files first
COPY . .

# Install dependencies
RUN npm install

# Create necessary directories if they don't exist
RUN mkdir -p client server

# Expose port
EXPOSE 3000

# Start the application
CMD ["npm", "start"] 