import React from 'react'

export function isEmpty (obj) {
  return Object.keys(obj).length === 0
}

export function isPrintable (str) {
  return !/^[ \t\n　]*$/.test(str)
}

export const QuizRoomContext = React.createContext()

export function roomStorage (roomid) {
  return {
    getItem: key => sessionStorage.getItem(roomid + key),
    setItem: (key, value) => sessionStorage.setItem(roomid + key, value)
  }
}
