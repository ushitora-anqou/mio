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

const room = fileExists('room.json')
  ? JSON.parse(fs.readFileSync('room.json'))
  : {}
const user = fileExists('user.json')
  ? JSON.parse(fs.readFileSync('user.json'))
  : {}

const shutdownGracefully = () => {
  fs.writeFileSync('room.json', JSON.stringify(room))
  fs.writeFileSync('user.json', JSON.stringify(user))
  process.exit(0)
}

process.on('SIGTERM', shutdownGracefully)
process.on('SIGINT', shutdownGracefully)

function createUser (roomid) {
  const uid = uuid()
  const password = uuid()
  user[uid] = { password, roomid }
  return { uid, password }
}

function createRoom () {
  const roomid = uuid()
  const { uid, password } = createUser(roomid)
  room[roomid] = { master: uid }
  return { uid, password, roomid }
}

function roomExists (roomid) {
  return room.hasOwnProperty(roomid)
}

function userExists (uid, password, roomid) {
  return (
    user.hasOwnProperty(uid) &&
    user[uid].password === password &&
    user[uid].roomid === roomid
  )
}

io.on('connection', socket => {
  const log = msg => {
    console.log('[' + socket.id + '] ' + msg)
  }

  log('Connect')

  socket.on('create-room', (param, cb) => {
    const { uid, password, roomid } = createRoom()
    cb(uid, password, roomid)
  })

  socket.on('issue-uid', (param, cb) => {
    const roomid = param.roomid
    if (!roomExists(roomid)) {
      log('roomid ' + roomid + ' not found')
      cb('ng')
      return
    }
    const { uid, password } = createUser(roomid)
    cb('ok', uid, password)
  })

  socket.emit('auth', {}, (uid, password, roomid) => {
    // check uid and password are correct
    if (!userExists(uid, password, roomid)) {
      log('auth failed ' + uid)
      socket.emit('auth-result', { status: 'ng' })
      return
    }
    // if (!room.hasOwnProperty(roomid))  return false

    socket.join(roomid)
    log('auth: ' + uid + ' / ' + roomid)

    user[uid].sid = socket.id

    socket.on('chat-msg', (msg, cb) => {
      log('chat-msg: ' + msg)
      io.to(roomid).emit('chat-msg', { id: uuid(), body: msg })
      cb('ok')
    })

    socket.on('quiz-music', (msg, cb) => {
      // check the user is master
      if (room[roomid].master !== uid) {
        log('quiz-music failed')
        cb('ng')
        return
      }

      log('quiz-music: ' + msg.buf.length)

      socket.to(roomid).emit('quiz-music', msg)
      cb('ok')
    })

    socket.on('quiz-answer', (msg, cb) => {
      log('quiz-answer: ' + msg.answer)

      io.to(user[room[roomid].master].sid).emit('quiz-answer', {
        uid: uid,
        time: msg.time,
        answer: msg.answer
      })

      cb('ok')
    })

    socket.on('quiz-result', (msg, cb) => {
      log('quiz-result: ' + JSON.stringify(msg))

      socket.to(roomid).emit('quiz-result', msg)

      cb()
    })

    socket.on('disconnect', () => {
      log('Leave')
    })

    socket.emit('auth-result', { status: 'ok' })
    return
  })
})
