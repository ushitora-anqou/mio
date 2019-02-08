const uuid = require('uuid/v4')
const fs = require('fs')

const server = require('http').createServer()
const io = require('socket.io')(server, {
  serveClient: false
})
const port = process.env.PORT || 4000
server.listen(port)

function fileExists (path) {
  try {
    fs.statSync(path)
    return true
  } catch (err) {
    return false
  }
}

console.log('start listening at port ' + port)

const user2sid = {}
const roomid = 'default room'
const room = fileExists('data.json')
  ? JSON.parse(fs.readFileSync('data.json'))
  : { master: null }

const shutdownGracefully = () => {
  fs.writeFileSync('data.json', JSON.stringify(room))
  process.exit(0)
}

process.on('SIGTERM', shutdownGracefully)
process.on('SIGINT', shutdownGracefully)

io.on('connection', socket => {
  const log = msg => {
    console.log('[' + socket.id + '] ' + msg)
  }

  socket.join(roomid)
  log('Join in ' + roomid)

  socket.on('issue-uid', (x, cb) => {
    const uid = uuid()
    const password = uuid()
    cb(uid, password)
  })

  socket.emit('auth', {}, (uid, password) => {
    // TODO: check uid and password are correct
    log('auth: ' + uid)

    user2sid[uid] = socket.id

    socket.on('chat-msg', (msg, cb) => {
      log('chat-msg: ' + msg)
      io.to(roomid).emit('chat-msg', { id: uuid(), body: msg })
      cb()
    })

    socket.on('quiz-music', (msg, cb) => {
      log('quiz-music: ' + msg.buf.length)

      room.master = uid

      socket.broadcast.to(roomid).emit('quiz-music', msg)
      cb()
    })

    socket.on('quiz-time', (msg, cb) => {
      log('quiz-time: ' + msg.time)

      io.to(user2sid[room.master]).emit('quiz-time', {
        uid: uid,
        time: msg.time
      })

      cb()
    })

    socket.on('quiz-answer', (msg, cb) => {
      log('quiz-answer: ' + msg.answer)

      io.to(user2sid[room.master]).emit('quiz-answer', {
        uid: uid,
        answer: msg.answer
      })

      cb()
    })

    socket.on('quiz-result', (msg, cb) => {
      log('quiz-result: ' + JSON.stringify(msg))

      socket.broadcast.to(roomid).emit('quiz-result', msg)

      cb()
    })

    socket.on('disconnect', () => {
      log('Leave')
    })
  })
})
