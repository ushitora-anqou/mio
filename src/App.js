import React, { Component } from 'react'
import './App.css'
import io from 'socket.io-client'
import { config } from './config'

class App extends Component {
  constructor (props) {
    super(props)

    console.log(config)

    this.socket = io(config.server_uri)
  }

  render () {
    return (
      <div className='App'>
        <h1>Hello holo</h1>
      </div>
    )
  }
}

export default App
