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

const STAGE = {
  WAITING_QUIZ_MUSIC: 0,
  WAITING_QUIZ_ANSWER: 1,
  WAITING_QUIZ_RESET: 2
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

  createUser (roomid, name) {
    const uid = 'U' + uuid()
    const password = 'P' + uuid()
    const created_at = Date.now()
    this.user[uid] = { name, password, roomid, created_at }
    return { uid, password }
  }

  createRoom (masterName) {
    const roomid = 'R' + uuid()
    const { uid, password } = this.createUser(roomid, masterName)
    const created_at = Date.now()
    const stage = STAGE.WAITING_QUIZ_MUSIC
    this.room[roomid] = { master: uid, created_at, stage }
    return { uid, password, roomid }
  }

  checkRoomStage (roomid, stage) {
    const room = this.room[roomid]
    if (!room) return false
    return room.stage === stage
  }

  updateRoomStage (roomid, stage) {
    this.room[roomid].stage = stage
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

  getNameOf (uid) {
    return this.user[uid].name
  }
}

const db = new Database({
  testing,
  room_json: 'room.json',
  user_json: 'user.json'
})
const server = http.createServer()
const io = socketio(server, {
  serveClient: false,
  maxHttpBufferSize: 500000
})
server.listen(port)
console_log('start listening at port ' + port)

io.on('connection', socket => {
  const log = msg => {
    console_log('[' + socket.id + '] ' + msg)
  }

  log('Connect')

  socket.on('error', err => {
    log('Error: ' + JSON.stringify(err))
  })

  socket.on('create-room', (param, cb) => {
    const { uid, password, roomid } = db.createRoom(param.masterName)
    cb(uid, password, roomid)
  })

  socket.on('issue-uid', (param, cb) => {
    const roomid = param.roomid
    if (!db.roomExists(roomid)) {
      log('roomid ' + roomid + ' not found')
      cb(null, null)
      return
    }
    const { uid, password } = db.createUser(roomid, param.name)
    cb(uid, password)
  })

  socket.emit('auth', {}, (uid, password, roomid) => {
    const log = msg => {
      console_log(`[${socket.id}][${uid} / ${roomid}] ${msg}`)
    }

    // check uid and password are correct
    if (!db.userExists(uid, password, roomid)) {
      log('auth failed ' + uid)
      socket.emit('auth-result', { status: 'ng' })
      return
    }
    // if (!room.hasOwnProperty(roomid))  return false

    socket.join(roomid)
    db.setSid(uid, socket.id)
    log('auth')

    const sendChatMsg = (tag, body = '') => {
      body = body || ''
      io.to(roomid).emit('chat-msg', {
        mid: uuid(),
        uid: uid,
        name: db.getNameOf(uid),
        body: body,
        tag: tag
      })
    }

    socket.on('chat-msg', (msg, cb) => {
      //log('chat-msg: ' + msg)
      sendChatMsg(msg.tag, msg.body)
      cb()
    })

    socket.on('quiz-music', (msg, cb) => {
      if (
        !(
          db.checkRoomStage(roomid, STAGE.WAITING_QUIZ_MUSIC) &&
          db.getRoomMasterUid(roomid) === uid
        )
      ) {
        log('quiz-music failed')
        return
      }

      db.updateRoomStage(roomid, STAGE.WAITING_QUIZ_ANSWER)

      log('quiz-music: ' + msg.buf.length)

      socket.to(roomid).emit('quiz-music', msg)
      cb()
    })

    socket.on('quiz-answer', (msg, cb) => {
      const master = db.getSid(db.getRoomMasterUid(roomid))

      if (
        !(
          db.checkRoomStage(roomid, STAGE.WAITING_QUIZ_ANSWER) &&
          master !== undefined
        )
      ) {
        log('quiz-answer failed')
        return
      }

      log('quiz-answer: ' + msg.answer)

      io.to(master).emit('quiz-answer', {
        uid: uid,
        time: msg.time,
        answer: msg.answer,
        name: db.getNameOf(uid)
      })

      cb()
    })

    socket.on('quiz-result', (msg, cb) => {
      if (!db.checkRoomStage(roomid, STAGE.WAITING_QUIZ_ANSWER)) {
        log('quiz-result failed')
        return
      }

      log('quiz-result: ' + JSON.stringify(msg))
      db.updateRoomStage(roomid, STAGE.WAITING_QUIZ_RESET)

      socket.to(roomid).emit('quiz-result', msg)

      cb()
    })

    socket.on('quiz-reset', (msg, cb) => {
      if (!(db.getSid(db.getRoomMasterUid(roomid)) !== undefined)) {
        log('quiz-reset failed')
        return
      }

      db.updateRoomStage(roomid, STAGE.WAITING_QUIZ_MUSIC)

      log('quiz-reset')

      socket.to(roomid).emit('quiz-reset', msg)

      cb()
    })

    socket.on('disconnect', () => {
      log('Leave')
      sendChatMsg('leave')

      db.deleteSidOf(uid)

      // Delete the room if no one is connecting to it
      if (!db.isAnyoneIn(roomid)) {
        log('Delete room')
        db.deleteRoom(roomid)
      }
    })

    sendChatMsg('join')

    socket.emit('auth-result', {
      status: 'ok',
      shouldWaitForReset: !db.checkRoomStage(roomid, STAGE.WAITING_QUIZ_MUSIC)
    })

    return
  })
})
