const dev = {
  redisUrl: '127.0.0.1:6379',
  port: 4000,
  serverOptions: {
    serveClient: false
  }
}

const test = {
  ...dev
}

const prod = {
  redisUrl: process.env.REDIS_URL,
  port: process.env.PORT,
  serverOptions: {
    maxHttpBufferSize: 500000
  }
}

const config = process.env.MIO_TEST ? test : process.env.MIO_PROD ? prod : dev

module.exports = config
