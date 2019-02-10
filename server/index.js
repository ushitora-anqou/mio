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
  const uid = 'U' + uuid()
  const password = 'P' + uuid()
  user[uid] = { password, roomid }
  return { uid, password }
}

function createRoom () {
  const roomid = 'R' + uuid()
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

// REMARK: Any user will be removed only by deleting the room
// that the user is in.
function deleteRoom (roomid) {
  delete room[roomid]
  Object.keys(user).forEach(uid => {
    if (user[uid].roomid === roomid) delete user[uid]
  })
}

const uid2sid = {}

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
      cb(null, null)
      return
    }
    const { uid, password } = createUser(roomid)
    cb(uid, password)
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

    uid2sid[uid] = socket.id

    socket.on('chat-msg', (msg, cb) => {
      log('chat-msg: ' + msg)
      io.to(roomid).emit('chat-msg', { id: uuid(), body: msg })
      cb()
    })

    socket.on('quiz-music', (msg, cb) => {
      // check the user is master
      if (room[roomid].master !== uid) {
        log('quiz-music failed')
        return
      }

      log('quiz-music: ' + msg.buf.length)

      socket.to(roomid).emit('quiz-music', msg)
      cb()
    })

    socket.on('quiz-answer', (msg, cb) => {
      const master = uid2sid[room[roomid].master]
      if (master === undefined) return

      log('quiz-answer: ' + msg.answer)

      io.to(master).emit('quiz-answer', {
        uid: uid,
        time: msg.time,
        answer: msg.answer
      })

      cb()
    })

    socket.on('quiz-result', (msg, cb) => {
      log('quiz-result: ' + JSON.stringify(msg))

      socket.to(roomid).emit('quiz-result', msg)

      cb()
    })

    socket.on('disconnect', () => {
      log('Leave')

      delete uid2sid[uid]

      // Delete the room if no one is connecting to it
      const no_one_is_here = !Object.keys(user).some(
        uid => user[uid].roomid === roomid && uid2sid.hasOwnProperty(uid)
      )
      if (no_one_is_here) {
        log('Delete ' + roomid)
        deleteRoom(roomid)
      }
    })

    socket.emit('auth-result', { status: 'ok' })
    return
  })
})
