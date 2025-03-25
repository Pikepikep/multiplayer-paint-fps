# Use Node.js LTS version
FROM node:20-slim

# Create app directory
WORKDIR /usr/src/app

# Copy all files
COPY . .

# Install root dependencies
RUN npm install

# Install server dependencies
WORKDIR /usr/src/app/server
RUN npm install

# Return to app root
WORKDIR /usr/src/app

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server/server.js"] 