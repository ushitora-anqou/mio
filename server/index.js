const uuid = require('uuid/v4')
const config = require('./config')

function console_log (str) {
  config.noprint || console.log(str)
}

const STAGE = {
  WAITING_QUIZ_MUSIC: 0,
  WAITING_QUIZ_ANSWER: 1,
  WAITING_QUIZ_RESET: 2
}

async function main () {
  console_log(`config: ${JSON.stringify(config)}`)

  //const db = new JSONDatabase({
  //  testing: false,
  //  room_json: 'room.json',
  //  user_json: 'user.json'
  //})
  //await require('./database')(config.databaseUrl, config.databaseOptions)
  //const db = await newRedisDatabase()
  const db = await require('./database')(config.redisUrl)
  const io = config.createSocketIOServer()

  // initialize db
  db.setAllRoomStage(STAGE.WAITING_QUIZ_MUSIC)

  io.on('connection', socket => {
    const log = msg => {
      console_log('[' + socket.id + '] ' + msg)
    }

    log('Connect')

    socket.on('error', err => {
      log('Error: ' + JSON.stringify(err))
    })

    socket.on('create-room', (param, done) => {
      const { uid, password, roomid } = db.createRoom(
        param.masterName,
        STAGE.WAITING_QUIZ_MUSIC
      )
      done(uid, password, roomid)
    })

    socket.on('issue-uid', (param, done) => {
      const roomid = param.roomid
      if (!db.roomExists(roomid)) {
        log('roomid ' + roomid + ' not found')
        done(null, null)
        return
      }
      const { uid, password } = db.createUser(roomid, param.name)
      done(uid, password)
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

      socket.on('chat-msg', (msg, done) => {
        //log('chat-msg: ' + msg)
        sendChatMsg(msg.tag, msg.body)
        done()
      })

      socket.on('quiz-music', (msg, done) => {
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
        done()
      })

      socket.on('quiz-answer', (msg, done) => {
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

        done()
      })

      socket.on('quiz-result', (msg, done) => {
        if (!db.checkRoomStage(roomid, STAGE.WAITING_QUIZ_ANSWER)) {
          log('quiz-result failed')
          return
        }

        log('quiz-result: ' + JSON.stringify(msg))
        db.updateRoomStage(roomid, STAGE.WAITING_QUIZ_RESET)

        socket.to(roomid).emit('quiz-result', msg)

        done()
      })

      socket.on('quiz-reset', (msg, done) => {
        if (!(db.getSid(db.getRoomMasterUid(roomid)) !== undefined)) {
          log('quiz-reset failed')
          return
        }

        db.updateRoomStage(roomid, STAGE.WAITING_QUIZ_MUSIC)

        log('quiz-reset')

        socket.to(roomid).emit('quiz-reset', msg)

        done()
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
}

main()
