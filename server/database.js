const uuid = require('uuid/v4')
const fs = require('fs')
const Redis = require('ioredis')

function fileExists (path) {
  try {
    fs.statSync(path)
    return true
  } catch (err) {
    return false
  }
}

class NaiveDatabase {
  constructor (room, user) {
    this.room = room
    this.user = user
    this.uid2sid = {}
  }

  createUser (roomid, name) {
    const uid = 'U' + uuid()
    const password = 'P' + uuid()
    const created_at = Date.now()
    this.user[uid] = { name, password, roomid, created_at }
    return { uid, password }
  }

  createRoom (masterName, initialStage) {
    const roomid = 'R' + uuid()
    const { uid, password } = this.createUser(roomid, masterName)
    const created_at = Date.now()
    const stage = initialStage
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

  setAllRoomStage (stage) {
    Object.keys(this.room).forEach(roomid => {
      this.room[roomid].stage = stage
    })
  }
}

class JSONDatabase extends NaiveDatabase {
  constructor (options) {
    const room =
      fileExists(options.room_json) && !options.testing
        ? JSON.parse(fs.readFileSync(options.room_json))
        : {}
    const user =
      fileExists(options.user_json) && !options.testing
        ? JSON.parse(fs.readFileSync(options.user_json))
        : {}
    super(room, user)

    this.testing = options.testing
    this.room_json = options.room_json
    this.user_json = options.user_json

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
}

class RedisDatabase extends NaiveDatabase {
  constructor (options) {
    super(options.room, options.user)
    this.options = options

    this.shutdownGracefully = this.shutdownGracefully.bind(this)
    process.on('SIGTERM', this.shutdownGracefully)
    process.on('SIGINT', this.shutdownGracefully)
  }

  shutdownGracefully () {
    if (!this.options.testing) {
      this.options.redis.set(this.options.room_key, JSON.stringify(this.room))
      this.options.redis.set(this.options.user_key, JSON.stringify(this.user))
    }
    process.exit(0)
  }
}

async function newRedisDatabase (redisUrl, testing = false) {
  const room_key = 'mio:room'
  const user_key = 'mio:user'
  const redis = new Redis(redisUrl)

  const room_json = await redis.get(room_key)
  const user_json = await redis.get(user_key)
  const room = room_json ? JSON.parse(room_json) : {}
  const user = user_json ? JSON.parse(user_json) : {}

  return new RedisDatabase({
    redis,
    room,
    user,
    room_key,
    user_key,
    testing
  })
}

async function newSequelizeDatabase (url, options) {
  const uuid = require('uuid/v4')
  const Sequelize = require('sequelize')
  const sequelize = new Sequelize(url, {
    dialect: 'postgres',
    ...options
  })
  const Op = Sequelize.Op

  const User = sequelize.define('user', {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
      defaultValue: Sequelize.UUIDV4
    },
    password: {
      type: Sequelize.STRING,
      allowNull: false,
      defaultValue: () => uuid()
    },
    socketId: {
      type: Sequelize.STRING,
      defaultValue: null
    },
    name: {
      type: Sequelize.STRING,
      allowNull: false
    }
  })

  const Room = sequelize.define('room', {
    id: {
      type: Sequelize.UUID,
      allowNull: false,
      primaryKey: true,
      defaultValue: Sequelize.UUIDV4
    },
    stage: {
      type: Sequelize.INTEGER,
      allowNull: false
    }
  })

  // TODO: Assume that an only one server (and only one thread) writes to the database.
  class SequelizeDatabase {
    async createUser (roomid, name) {
      const room = await Room.findOne({ where: { id: roomid } })
      const user = await room.createUser({ name })
      return { uid: user.id, password: user.password }
    }

    async createRoom (masterName, initialStage) {
      const room = await Room.create({ stage: initialStage })
      const master = await room.createUser({ name: masterName })
      await room.setMaster(master)
      return { uid: master.id, password: master.password, roomid: room.id }
    }

    async checkRoomStage (roomid, stage) {
      try {
        const room = await Room.findOne({ where: { id: roomid } })
        return room.stage === stage
      } catch (err) {
        return false
      }
    }

    updateRoomStage (roomid, stage) {
      return Room.update({ stage }, { where: { id: roomid } })
    }

    async roomExists (roomid) {
      try {
        const room = await Room.findOne({ where: { id: roomid } })
        return !!room
      } catch (err) {
        return false
      }
    }

    async userExists (uid, password, roomid) {
      try {
        const user = await User.findOne({
          where: { id: uid, password, roomId: roomid }
        })
        return !!user
      } catch (err) {
        return false
      }
    }

    // REMARK: Any user will be removed only by deleting the room
    // that the user is in.
    deleteRoom (roomid) {
      return Room.destroy({ where: { id: roomid } })
    }

    async isIn (uid, roomid) {
      const user = await User.findOne({
        where: { id: uid, roomId: roomid, socketId: { [Op.ne]: null } }
      })
      return !!user
    }

    async isAnyoneIn (roomid) {
      const users = await User.findOne({
        where: { roomId: roomid, socketId: { [Op.ne]: null } }
      })
      return !!users
    }

    async getRoomMasterUid (roomid) {
      return (await Room.findOne({ where: { id: roomid } })).masterId
    }

    setSid (uid, sid) {
      return User.update({ socketId: sid }, { where: { id: uid } })
    }

    async getSid (uid) {
      return (await User.findOne({ where: { id: uid } })).socketId
    }

    deleteSidOf (uid) {
      return this.setSid(uid, null)
    }

    async getNameOf (uid) {
      const user = await User.findOne({ where: { id: uid } })
      return user.name
    }

    async setAllRoomStage (stage) {
      return Room.update({ stage }, { where: {} })
    }

    async setAllUsersSocketId (socketId) {
      return User.update({ socketId }, { where: {} })
    }
  }

  await User.sync()
  await Room.sync()
  Room.hasMany(User, { onDelete: 'CASCADE', hooks: true })
  const Master = Room.belongsTo(User, { as: 'master' })
  await User.sync({ force: false, alter: true })
  await Room.sync({ force: false, alter: true })

  return new SequelizeDatabase()
}

module.exports = newSequelizeDatabase
//module.exports = newRedisDatabase

///

const chalk = require('chalk')

function assert (actual, expected) {
  console.log(chalk.yellow('.'))
  if (actual !== expected)
    console.log(chalk.yellow('\nact: ' + actual + '\nexp: ' + expected))
}

async function test () {
  const config = require('./config')
  const db = await newSequelizeDatabase(
    config.databaseUrl,
    config.databaseOptions
  )

  const {
    uid: masterUid,
    roomid,
    password: masterPassword
  } = await db.createRoom('master', 0)
  console.log(roomid)
  assert(await db.getNameOf(masterUid), 'master')

  assert(await db.userExists(masterUid, masterPassword, roomid), true)

  assert(await db.getRoomMasterUid(roomid), masterUid)
  await db.setSid(masterUid, 'hoge')
  assert(await db.getSid(masterUid), 'hoge')

  console.log(await db.createUser(roomid, 'hogepiyo'))

  assert(await db.checkRoomStage(roomid, 0), true)
  assert(
    await db.checkRoomStage('ac2d8ccb-b1d7-4022-a05f-20c9d91c943c', 0),
    false
  )
  assert(await db.checkRoomStage('hogehoge', 0), false)

  await db.updateRoomStage(roomid, 1)
  assert(await db.checkRoomStage(roomid, 1), true)
  await db.setAllRoomStage(0)
  assert(await db.checkRoomStage(roomid, 0), true)

  assert(await db.roomExists(roomid), true)
  assert(await db.roomExists('ac2d8ccb-b1d7-4022-a05f-20c9d91c943c'), false)
  assert(await db.roomExists('hogepiyo'), false)

  assert(await db.isAnyoneIn(roomid), true)
  await db.deleteSidOf(masterUid)
  assert(await db.getSid(masterUid), null)
  assert(await db.isAnyoneIn(roomid), false)

  await db.deleteRoom(roomid)
  assert(await db.roomExists(roomid), false)

  console.log(chalk.yellow('done'))
}

//test()
