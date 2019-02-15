FROM node:11.9.0-alpine

WORKDIR /opt/mio

COPY . .
RUN NODE_ENV=production yarn install --pure-lockfile
RUN yarn build

RUN adduser -D myuser
USER myuser

ENV MIO_PROD 1

CMD node server/index.js
