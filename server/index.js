const server = require('http').createServer()
const io = require('socket.io')(server, {
  serveClient: false
})
const port = process.env.PORT || 4000
server.listen(port)
const uuid = require('uuid/v4')

console.log('start listening at port ' + port)

io.on('connection', socket => {
  const log = msg => {
    console.log('[' + socket.id + '] ' + msg)
  }

  log('Join')

  socket.join('default room')

  socket.on('chat-msg', msg => {
    log('chat-msg: ' + msg)
    io.emit('chat-msg', { id: uuid(), body: msg })
  })

  socket.on('disconnect', () => {
    log('Leave')
  })
})
