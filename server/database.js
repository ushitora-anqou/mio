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
      allowNull: false,
      defaultValue: 0
    }
  })

  // TODO: Assume that an only one server (and only one thread) writes to the database.
  class SequelizeDatabase {
    async createUser (roomid, name) {
      const room = await Room.findOne({ where: { id: roomid } })
      const user = await room.createUser({ name })
      return { uid: user.id, password: user.password }
    }

    async createRoom (masterName) {
      const room = await Room.create()
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

    // REMARK: Any user will be removed only by deleting the room
    // that the user is in.
    deleteRoom (roomid) {
      return Room.destroy({ where: { id: roomid } })
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

    async getSid (uid, sid) {
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
  }

  await User.sync({ force: true })
  await Room.sync({ force: true })
  Room.hasMany(User, { onDelete: 'CASCADE', hooks: true })
  const Master = Room.belongsTo(User, { as: 'master' })
  await User.sync({ force: false, alter: true })
  await Room.sync({ force: false, alter: true })

  return new SequelizeDatabase()
}

module.exports = newSequelizeDatabase

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

  const { uid: masterUid, roomid } = await db.createRoom('master')
  console.log(roomid)
  assert(await db.getNameOf(masterUid), 'master')

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
