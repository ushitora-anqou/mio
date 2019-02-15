# Mio - Intro Quiz App

## local

- `yarn start`
- `node server/index.js`

## prod in local

- `yarn build`
- `MIO_PROD=1 PORT=5000 REDIS_URL="127.0.0.1:6379" node server/index.js`

## docker

- `sudo docker build --build-arg REACT_APP_SERVER_URI=localhost:5000 -t mio .`
- `sudo docker run -p 5000:5000 --env-file .env -id --rm mio`

## heroku

- `heroku config:set REACT_APP_SERVER_URI=(server's uri)`
