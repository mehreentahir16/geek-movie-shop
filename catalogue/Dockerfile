FROM node:16

EXPOSE 8080

WORKDIR /opt/server

COPY package.json /opt/server/

RUN npm install

COPY src/* /opt/server/

CMD ["node", "server.js"]
