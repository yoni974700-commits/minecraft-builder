FROM maven:3.9-eclipse-temurin-21

WORKDIR /app

COPY package*.json ./
RUN apt-get update && apt-get install -y nodejs npm && npm install

COPY . .

CMD ["npm", "start"]
