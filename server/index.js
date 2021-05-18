const uuid = require('uuid/v4')
const config = require('./config')
const chalk = require('chalk')
const Joi = require('@hapi/joi')

function console_log (str) {
  config.noprint || console.log(chalk.yellow('[mio] ' + str))
}

const schemaDefinition = {}
// $ echo "寿限無寿限無五劫の擦り切れ海砂利水魚の水行末雲来末風来末食う寝る処に住む処藪ら柑子の藪柑子パイポパイポパイポのシューリンガンシューリンガンのグーリンダイグーリンダイのポンポコピーのポンポコナーの長久命の長助" | wc -m
// 104
// # Therefore the length of 128 is enough :)
schemaDefinition.name = Joi.string().max(128)
// uuid() function is obsolete; use guid()
schemaDefinition.roomid = Joi.string().guid({version: ['uuidv4']})
schemaDefinition.uid = Joi.string().guid({version: ['uuidv4']})
schemaDefinition.password = Joi.string().guid({version: ['uuidv4']})
schemaDefinition.time = Joi.number().min(0)
schemaDefinition.allotment = Joi.number()
  .integer()
  .min(-128)
  .max(127)
schemaDefinition.roomExists = {
  msg: {
    roomid: schemaDefinition.roomid.required()
  },
  done: Joi.func().required()
}
schemaDefinition.createRoom = {
  param: {
    masterName: schemaDefinition.name.required(),
    correctPoint: schemaDefinition.allotment.required(),
    wrongPoint: schemaDefinition.allotment.required()
  },
  done: Joi.func().required()
}
schemaDefinition.issueUid = {
  param: {
    roomid: schemaDefinition.roomid.required(),
    name: schemaDefinition.name.required()
  },
  done: Joi.func().required()
}
schemaDefinition.auth = {
  uid: schemaDefinition.uid.required(),
  password: schemaDefinition.password.required(),
  roomid: schemaDefinition.roomid.required()
}
schemaDefinition.chatMsg = {
  msg: {
    tag: Joi.string().required(),
    body: Joi.string().required()
  },
  done: Joi.func().required()
}
schemaDefinition.quizMusic = {
  msg: {
    buf: Joi.binary().required(),
    stoppable: Joi.boolean().required()
  },
  done: Joi.func().required()
}
schemaDefinition.quizAnswer = {
  msg: {
    answer: Joi.string().allow(null),
    time: schemaDefinition.time.required()
  },
  done: Joi.func().required()
}
schemaDefinition.quizResult = {
  msg: {
    answer: Joi.string().required(),
    answers: Joi.object().unknown(true)
  },
  done: Joi.func().required()
}
schemaDefinition.quizResultAnswer = {
  uid: schemaDefinition.uid.required(),
  name: schemaDefinition.name.required(),
  time: schemaDefinition.time.required(),
  answer: Joi.any().when('judge', {
    is: Joi.exist(),
    then: Joi.string().required(),
    otherwise: Joi.valid(null)
  }),
  judge: Joi.boolean()
}
schemaDefinition.quizReset = {
  msg: {
    message: Joi.string()
  },
  done: Joi.func().required()
}
schemaDefinition.changeScore = {
  msg: {
    uid: schemaDefinition.uid,
    maru: Joi.number()
      .min(-2147483648)
      .max(2147483647)
      .required(),
    peke: Joi.number()
      .min(-2147483648)
      .max(2147483647)
      .required(),
    points: Joi.number()
      .min(-2147483648)
      .max(2147483647)
      .required()
  },
  done: Joi.func().required()
}
schemaDefinition.changeAllotment = {
  msg: {
    correctPoint: schemaDefinition.allotment.required(),
    wrongPoint: schemaDefinition.allotment.required()
  },
  done: Joi.func().required()
}

function validate (value, schemaDefinition) {
  if (!value) {
    console_log('validation failed: value is evaluated to be false')
    return false
  }

  const schema = Joi.compile(schemaDefinition)

  const result = schema.validate(value, { convert: false })
  if (result.error) console_log(`validation failed: ${result.error}`)
  return !!result.error
}

const STAGE = {
  WAITING_QUIZ_MUSIC: 0,
  WAITING_STOP_MUSIC: 3,
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
  const db = await require('./database')(
    config.databaseUrl,
    config.databaseOptions
  )
  //const db = await newRedisDatabase()
  //const db = await require('./database')(config.redisUrl)
  const io = config.createSocketIOServer()

  // initialize db
  await db.setAllRoomStage(STAGE.WAITING_QUIZ_MUSIC)
  await db.setAllUsersSocketId(null)

  io.on('connection', socket => {
    const handshake = JSON.stringify(socket.handshake)
    const glog = msg => {
      console_log('[' + socket.id + '] ' + msg)
    }
    const io_to_emit = (roomid, ...args) => {
      socket.to(roomid).emit(...args)
      socket.emit(...args)
    }
    let alreadyIssuedUid = false

    glog(`Connect: ${handshake}`)

    socket.on('error', err => {
      glog('Error: ' + JSON.stringify(err))
    })

    socket.on('create-room', async (param, done) => {
      if (
        !(!alreadyIssuedUid && !validate({ param, done }, schemaDefinition.createRoom))
      ) {
        glog('create-room failed')
        return
      }

      const { uid, password, roomid } = await db.createRoom(
        {
          name: param.masterName,
          handshake,
          correctPoint: param.correctPoint,
          wrongPoint: param.wrongPoint
        },
        STAGE.WAITING_QUIZ_MUSIC
      )
      glog(`Create a room: ${roomid}`)
      alreadyIssuedUid = true
      done(uid, password, roomid)
    })

    socket.on('room-exists', async (msg, done) => {
      if (validate({ msg, done }, schemaDefinition.roomExists)) {
        done(false)
        return
      }

      const exists = await db.roomExists(msg.roomid)
      done(exists)
    })

    socket.on('issue-uid', async (param, done) => {
      if (!(!alreadyIssuedUid && !validate({ param, done }, schemaDefinition.issueUid))) {
        glog('issue-uid failed')
        return
      }

      const roomid = param.roomid
      if (!(await db.roomExists(roomid))) {
        glog('roomid ' + roomid + ' not found')
        done(null, null)
        return
      }

      const { uid, password } = await db.createUser(
        roomid,
        param.name,
        handshake
      )

      glog(`Issue an uid: ${uid}`)
      alreadyIssuedUid = true

      done(uid, password)
    })

    socket.emit('auth', {}, async (uid, password, roomid) => {
      // set sid if auth is correct
      try {
        if (validate({ uid, password, roomid }, schemaDefinition.auth))
          throw new Error('validation failed')
        if (await db.setSidIf(uid, password, roomid, socket.id))
          throw new Error('invalid authentication')
      } catch (err) {
        glog(`auth failed: ${err}`)
        socket.emit('auth-result', { status: 'ng' })
        return
      }

      // ASSERT: only one socket per uid can reach here.
      // In Socket.IO, asynchronized functions as event handler of a certain socket
      // are await-ed and executed in accepted order
      // (TODO: this behavior should be ensured).
      // Therefore, race condition (or something like that)
      // will never occur unless different sockets
      // operate on a same record of the database.

      const log = msg => {
        glog(`[${uid} / ${roomid}] ${msg}`)
      }

      const sendUserList = async () => {
        io_to_emit(roomid, 'users', await db.getAllUsersIn(roomid))
      }

      const sendQuizInfo = async () => {
        const room = await db.getRoom(roomid)
        io_to_emit(roomid, 'quiz-info', {
          round:
            room.stage === STAGE.WAITING_QUIZ_MUSIC
              ? room.round
              : room.round - 1,
          correctPoint: room.correctPoint,
          wrongPoint: room.wrongPoint
        })
      }

      const sendChatMsg = async (tag, body = '') => {
        body = body || ''
        io_to_emit(roomid, 'chat-msg', {
          mid: uuid(),
          uid: uid,
          name: await db.getNameOf(uid),
          body: body,
          tag: tag
        })
      }

      const isMaster = (await db.getRoomMasterUid(roomid)) === uid

      socket.join(socket.id)
      socket.join(roomid)
      log('auth')

      // If the master refresh the page, reset the game.
      // TODO: stable page refreshing
      if (
        isMaster &&
        !(await db.isRoomStage(roomid, STAGE.WAITING_QUIZ_MUSIC))
      ) {
        await db.updateRoomStage(roomid, STAGE.WAITING_QUIZ_MUSIC)
        sendQuizInfo()
        const message =
          "Sorry! The master's connection to the server was lost, so the game has been reset."
        socket.to(roomid).emit('quiz-reset', { message })
      }

      sendUserList()
      sendQuizInfo()

      socket.on('chat-msg', (msg, done) => {
        if (validate({ msg, done }, schemaDefinition.chatMsg)) {
          glog('chat-msg failed')
          return
        }

        //log('chat-msg: ' + msg)
        sendChatMsg(msg.tag, msg.body)
        done()
      })

      socket.on('quiz-music', async (msg, done) => {
        if (
          !(
            !validate({ msg, done }, schemaDefinition.quizMusic) &&
            (await db.isRoomStage(roomid, STAGE.WAITING_QUIZ_MUSIC)) &&
            isMaster
          )
        ) {
          log('quiz-music failed')
          return
        }

        await db.updateRoomStage(
          roomid,
          msg.stoppable ? STAGE.WAITING_STOP_MUSIC : STAGE.WAITING_QUIZ_ANSWER
        )

        // increment the round in advance to send the new round when this game is reset in between
        await db.updateRound(roomid)

        log('quiz-music: ' + msg.buf.length)

        socket.to(roomid).emit('quiz-music', msg)
        done()
      })

      socket.on('quiz-stop-music', async () => {
        if (
          await db.updateRoomStageIf(
            roomid,
            STAGE.WAITING_STOP_MUSIC,
            STAGE.WAITING_QUIZ_ANSWER
          )
        ) {
          log('quiz-stop-music failed')
          return
        }

        log('quiz-stop-music')

        socket.to(roomid).emit('quiz-stop-music')
      })

      socket.on('quiz-answer', async (msg, done) => {
        const master = await db.getSid(await db.getRoomMasterUid(roomid))

        if (
          !(
            !validate({ msg, done }, schemaDefinition.quizAnswer) &&
            (await db.isRoomStage(roomid, STAGE.WAITING_QUIZ_ANSWER)) &&
            master !== undefined &&
            !isMaster
          )
        ) {
          log('quiz-answer failed')
          return
        }

        log('quiz-answer: ' + (msg.answer ? msg.answer : 'THROUGH'))

        socket.to(master).emit('quiz-answer', {
          uid: uid,
          time: msg.time,
          answer: msg.answer,
          name: await db.getNameOf(uid)
        })

        done()
      })

      socket.on('quiz-result', async (msg, done) => {
        if (
          !(
            !validate({ msg, done }, schemaDefinition.quizResult) &&
            Object.keys(msg.answers).every(
              uid =>
                !validate(uid, schemaDefinition.uid) &&
                !validate(msg.answers[uid], schemaDefinition.quizResultAnswer)
            ) &&
            ((await db.isRoomStage(roomid, STAGE.WAITING_STOP_MUSIC)) ||
              (await db.isRoomStage(roomid, STAGE.WAITING_QUIZ_ANSWER))) &&
            isMaster
          )
        ) {
          log('quiz-result failed')
          return
        }

        log('quiz-result: ' + JSON.stringify(msg))
        for (const uid of Object.keys(msg.answers))
          await db.updateScore(uid, roomid, msg.answers[uid].judge)
        await db.updateRoomStage(roomid, STAGE.WAITING_QUIZ_RESET)

        sendUserList()
        socket.to(roomid).emit('quiz-result', msg)

        done()
      })

      socket.on('quiz-reset', async (msg, done) => {
        try {
          if (validate({ msg, done }, schemaDefinition.quizReset) && isMaster)
            throw new Error('validation failed')
          if (
            await db.updateRoomStageIf(
              roomid,
              STAGE.WAITING_QUIZ_RESET,
              STAGE.WAITING_QUIZ_MUSIC
            )
          )
            throw new Error('stage is not WAITING_QUIZ_RESET')

          log('quiz-reset')

          sendQuizInfo()
          socket.to(roomid).emit('quiz-reset', { message: msg.message })

          done()
        } catch (err) {
          log(`quiz-reset failed: ${err}`)
        }
      })

      socket.on('change-score', async (msg, done) => {
        if (!(!validate({ msg, done }, schemaDefinition.changeScore) && isMaster)) {
          log('change-score failed')
          return
        }

        log('change-score')

        await db.updateUser(msg.uid, {
          maru: msg.maru,
          peke: msg.peke,
          points: msg.points
        })

        sendUserList()

        done()
      })

      socket.on('change-allotment', async (msg, done) => {
        if (!(!validate({ msg, done }, schemaDefinition.changeAllotment) && isMaster)) {
          log('change-allotment failed')
          return
        }

        log('change-allotment')

        await db.updateAllotment(roomid, {
          correctPoint: msg.correctPoint,
          wrongPoint: msg.wrongPoint
        })

        sendQuizInfo()

        done()
      })

      socket.on('disconnect', async () => {
        log('Leave')
        sendChatMsg('leave')

        await db.deleteSidOf(uid)

        if (await db.deleteRoomIfNoOneIsIn(roomid)) {
          // not deleted
          sendUserList()
          return
        }

        log('Delete room')
      })

      sendChatMsg('join')

      socket.emit('auth-result', {
        status: 'ok',
        shouldWaitForReset: !(await db.isRoomStage(
          roomid,
          STAGE.WAITING_QUIZ_MUSIC
        ))
      })

      return
    })

    socket.on('disconnect', () => {
      glog('Disconnect')
    })
  })
}

main()
