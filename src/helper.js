import React from 'react'
import { config } from './config'
import io from 'socket.io-client'

export function isEmpty (obj) {
  return Object.keys(obj).length === 0
}

export function isPrintable (str) {
  return !/^[ \t\n　]*$/.test(str)
}

export const QuizRoomContext = React.createContext()

export function roomStorage (roomid) {
  return {
    getItem: key => config.storage.getItem(roomid + key),
    setItem: (key, value) => config.storage.setItem(roomid + key, value)
  }
}

export function newSocket () {
  return io(config.server_uri)
}
