FROM node:18-alpine

WORKDIR /home/node/app

COPY package*.json ./
COPY yarn.lock ./
COPY . .

RUN yarn && yarn build

EXPOSE 3423

CMD [ "npm", "start" ]
