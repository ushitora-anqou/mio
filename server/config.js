const express = require('express')
const socketio = require('socket.io')
const http = require('http')
const path = require('path')

const dev = {
  redisUrl: '127.0.0.1:6379',
  port: 4000,
  createSocketIOServer: function () {
    const server = http.createServer()
    const io = socketio(server, { serveClient: false })
    server.listen(this.port)
    console.log('start listening at port ' + this.port)
    return io
  },
  databaseUrl: 'postgres://localhost:5432/testdb',
  databaseOptions: {}
}

const test = {
  ...dev
}

const prod = {
  redisUrl: process.env.REDIS_URL,
  port: process.env.PORT,
  static: path.resolve('build'),
  createSocketIOServer: function () {
    const server = express()
      .use(express.static(this.static))
      .use((req, res) => res.sendFile(path.join(this.static, 'index.html')))
      .listen(this.port, () =>
        console.log('start listening at port ' + this.port)
      )
    const io = socketio(server, { maxHttpBufferSize: 500000 })
    return io
  },
  databaseUrl: process.env.DATABASE_URL,
  databaseOptions: { native: true }
}

const config = process.env.MIO_TEST ? test : process.env.MIO_PROD ? prod : dev

module.exports = config
