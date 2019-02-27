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

class AudioManager {
  constructor () {
    this.audioCtx = null
  }

  isEnabled () {
    return !!this.audioCtx
  }

  resetContext () {
    const AudioContext = window.AudioContext || window.webkitAudioContext
    this.audioCtx = new AudioContext()
  }

  decodeAudioData (buf) {
    return this.audioCtx.decodeAudioData(buf)
  }

  getCurrentTime () {
    return this.audioCtx.currentTime
  }

  getContext () {
    return this.audioCtx
  }

  playMusic (buf, options = {}) {
    const source = this.audioCtx.createBufferSource()
    source.buffer = buf
    source.connect(this.audioCtx.destination)
    source.onended = options.onended
    source.start(options.when, options.offset, options.duration)
    return source
  }
}
export const audioMan = new AudioManager()
