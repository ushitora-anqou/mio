const express = require('express')
const socketio = require('socket.io')
const http = require('http')
const path = require('path')

// Configuration on development environment
const dev = {
  // Server's port number.
  // This number should be corresponding to the number at src/server.js
  port: 4000,
  createSocketIOServer: function () {
    const server = http.createServer()
    const io = socketio(server, { serveClient: false })
    server.listen(this.port)
    console.log('start listening at port ' + this.port)
    return io
  },
  // specify postgresql's URL and database
  databaseUrl: 'postgres://localhost:5432/testdb',
  databaseOptions: {}
}

// Configuration on test environment
const test = {
  ...dev
}

// Configuration on production environment
// $PORT : Server's port number
// $DATABASE_URL : Server's database URL
const prod = {
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
  databaseOptions: {
    dialect: 'postgres',
    protocol: 'postgres',
    dialectOptions: {
      ssl: true
    }
  }
}

const config = process.env.MIO_TEST ? test : process.env.MIO_PROD ? prod : dev

module.exports = config
