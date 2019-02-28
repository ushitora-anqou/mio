const uuid = require('uuid/v4')
const fs = require('fs')

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
    },
    handshake: {
      type: Sequelize.TEXT,
      allowNull: false
    },
    maru: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    peke: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 0
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
    },
    round: {
      type: Sequelize.INTEGER,
      allowNull: false,
      defaultValue: 1
    },
    correctPoint: {
      type: Sequelize.INTEGER,
      allowNull: false
    },
    wrongPoint: {
      type: Sequelize.INTEGER,
      allowNull: false
    }
  })

  // TODO: Assume that an only one server (and only one thread) writes to the database.
  class SequelizeDatabase {
    async createUser (roomid, name, handshake) {
      const room = await Room.findOne({ where: { id: roomid } })
      const user = await room.createUser({ name, handshake })
      return { uid: user.id, password: user.password }
    }

    async createRoom (masterSrc, initialStage) {
      const room = await Room.create({
        stage: initialStage,
        correctPoint: masterSrc.correctPoint,
        wrongPoint: masterSrc.wrongPoint
      })
      const master = await room.createUser({
        name: masterSrc.name,
        handshake: masterSrc.handshake
      })
      await room.setMaster(master)
      return { uid: master.id, password: master.password, roomid: room.id }
    }

    async getRoom (roomid) {
      const room = await Room.findOne({ where: { id: roomid } })
      if (!room) return null
      return {
        roomid,
        stage: room.stage,
        round: room.round,
        correctPoint: room.correctPoint,
        wrongPoint: room.wrongPoint
      }
    }

    async isRoomStage (roomid, stage) {
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

    async updateRoomStageIf (roomid, oldStage, newStage) {
      const result = await Room.update(
        { stage: newStage },
        {
          where: {
            id: roomid,
            stage: oldStage
          }
        }
      )
      return result[0] <= 0
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

    async getAllUsersIn (roomid) {
      const users = await User.findAll({ where: { roomId: roomid } })
      const master = await this.getRoomMasterUid(roomid)
      return users.map(user => ({
        uid: user.id,
        name: user.name,
        online: !!user.socketId,
        master: master === user.id,
        maru: user.maru,
        peke: user.peke
      }))
    }

    async _getUser (uid) {
      return User.findOne({ where: { id: uid } })
    }

    async updateScore (uid, correct) {
      if (correct === undefined || correct === null) return
      const user = await this._getUser(uid)
      return user.increment(correct ? 'maru' : 'peke')
    }

    async _getRoom (roomid) {
      return Room.findOne({ where: { id: roomid } })
    }

    async updateRound (roomid) {
      const oldRoom = await this._getRoom(roomid)
      const newRoom = await oldRoom.increment('round')
      return newRoom.round
    }

    async getRound (roomid) {
      return (await this._getRoom(roomid)).round
    }

    updateUser (uid, src) {
      return User.update(src, { where: { id: uid } })
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

/*
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

  assert(await db.isRoomStage(roomid, 0), true)
  assert(
    await db.isRoomStage('ac2d8ccb-b1d7-4022-a05f-20c9d91c943c', 0),
    false
  )
  assert(await db.isRoomStage('hogehoge', 0), false)

  await db.updateRoomStage(roomid, 1)
  assert(await db.isRoomStage(roomid, 1), true)
  await db.setAllRoomStage(0)
  assert(await db.isRoomStage(roomid, 0), true)

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
*/
