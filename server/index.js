const uuid = require('uuid/v4')
const fs = require('fs')
const http = require('http')
const socketio = require('socket.io')

const port = process.env.PORT || 4000
const testing = process.env.MIO_TEST ? true : false

function console_log (str) {
  testing || console.log(str)
}

function fileExists (path) {
  try {
    fs.statSync(path)
    return true
  } catch (err) {
    return false
  }
}

class Database {
  constructor (options) {
    this.testing = options.testing
    this.room_json = options.room_json
    this.user_json = options.user_json

    this.room =
      fileExists(this.room_json) && !this.testing
        ? JSON.parse(fs.readFileSync(this.room_json))
        : {}
    this.user =
      fileExists(this.user_json) && !this.testing
        ? JSON.parse(fs.readFileSync(this.user_json))
        : {}
    this.uid2sid = {}

    this.shutdownGracefully = this.shutdownGracefully.bind(this)
    process.on('SIGTERM', this.shutdownGracefully)
    process.on('SIGINT', this.shutdownGracefully)
  }

  shutdownGracefully () {
    if (!this.testing) {
      fs.writeFileSync(this.room_json, JSON.stringify(this.room))
      fs.writeFileSync(this.user_json, JSON.stringify(this.user))
    }
    process.exit(0)
  }

  createUser (roomid) {
    const uid = 'U' + uuid()
    const password = 'P' + uuid()
    this.user[uid] = { password, roomid }
    return { uid, password }
  }

  createRoom () {
    const roomid = 'R' + uuid()
    const { uid, password } = this.createUser(roomid)
    this.room[roomid] = { master: uid }
    return { uid, password, roomid }
  }

  roomExists (roomid) {
    return this.room.hasOwnProperty(roomid)
  }

  userExists (uid, password, roomid) {
    return (
      this.user.hasOwnProperty(uid) &&
      this.user[uid].password === password &&
      this.user[uid].roomid === roomid
    )
  }

  // REMARK: Any user will be removed only by deleting the room
  // that the user is in.
  deleteRoom (roomid) {
    delete this.room[roomid]
    Object.keys(this.user).forEach(uid => {
      if (this.user[uid].roomid === roomid) delete this.user[uid]
    })
  }

  isAnyoneIn (roomid) {
    return Object.keys(this.user).some(
      uid =>
        this.user[uid].roomid === roomid && this.uid2sid.hasOwnProperty(uid)
    )
  }

  getRoomMasterUid (roomid) {
    return this.room[roomid].master
  }

  setSid (uid, sid) {
    this.uid2sid[uid] = sid
  }

  getSid (uid) {
    return this.uid2sid[uid]
  }

  deleteSidOf (uid) {
    delete this.uid2sid[uid]
  }
}

const db = new Database({
  testing: testing,
  room_json: 'room.json',
  user_json: 'user.json'
})
const server = http.createServer()
const io = socketio(server, {
  serveClient: false
})
server.listen(port)
console_log('start listening at port ' + port)

io.on('connection', socket => {
  const log = msg => {
    console_log('[' + socket.id + '] ' + msg)
  }

  log('Connect')

  socket.on('create-room', (param, cb) => {
    const { uid, password, roomid } = db.createRoom()
    cb(uid, password, roomid)
  })

  socket.on('issue-uid', (param, cb) => {
    const roomid = param.roomid
    if (!db.roomExists(roomid)) {
      log('roomid ' + roomid + ' not found')
      cb(null, null)
      return
    }
    const { uid, password } = db.createUser(roomid)
    cb(uid, password)
  })

  socket.emit('auth', {}, (uid, password, roomid) => {
    // check uid and password are correct
    if (!db.userExists(uid, password, roomid)) {
      log('auth failed ' + uid)
      socket.emit('auth-result', { status: 'ng' })
      return
    }
    // if (!room.hasOwnProperty(roomid))  return false

    socket.join(roomid)
    log('auth: ' + uid + ' / ' + roomid)

    db.setSid(uid, socket.id)

    socket.on('chat-msg', (msg, cb) => {
      log('chat-msg: ' + msg)
      io.to(roomid).emit('chat-msg', { id: uuid(), body: msg })
      cb()
    })

    socket.on('quiz-music', (msg, cb) => {
      // check the user is master
      if (db.getRoomMasterUid(roomid) !== uid) {
        log('quiz-music failed')
        return
      }

      log('quiz-music: ' + msg.buf.length)

      socket.to(roomid).emit('quiz-music', msg)
      cb()
    })

    socket.on('quiz-answer', (msg, cb) => {
      const master = db.getSid(db.getRoomMasterUid(roomid))
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

      db.deleteSidOf(uid)

      // Delete the room if no one is connecting to it
      if (!db.isAnyoneIn(roomid)) {
        log('Delete ' + roomid)
        db.deleteRoom(roomid)
      }
    })

    socket.emit('auth-result', { status: 'ok' })
    return
  })
})
