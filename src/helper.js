import React from 'react'

export function isEmpty (obj) {
  return Object.keys(obj).length === 0
}

export function isPrintable (str) {
  return !/^[ \t\n　]*$/.test(str)
}

export const SocketContext = React.createContext()
