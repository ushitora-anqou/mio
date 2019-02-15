# Mio - Intro Quiz App

## local

- `yarn start`
- `node server/index.js`

## prod in local

- `yarn build`
- `MIO_PROD=1 PORT=5000 DATABASE_URL="postgres://localhost:5432/testdb" node server/index.js`

## docker

- `docker build --build-arg REACT_APP_SERVER_URI=localhost:5000 -t mio .`
- `docker run -p 5000:5000 --env-file .env -id --rm mio`

## heroku

- `heroku run MIO_PROD=1 node server/index.js`

- `heroku config:set REACT_APP_SERVER_URI=(server's uri)`
- `heroku container:push web`
- `heroku container:release web`
