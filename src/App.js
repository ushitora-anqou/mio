import React, { Component } from 'react'
import io from 'socket.io-client'
import update from 'immutability-helper'
import './App.css'
import { config } from './config'

class ChatWindow extends Component {
  constructor (props) {
    super(props)

    this.state = {
      history: [],
      input: ''
    }

    this.socket = props.socket
  }

  onChatMsg = msg => {
    this.setState((state, props) =>
      update(state, { history: { $push: [msg] } })
    )
  }

  componentDidMount () {
    this.socket.on('chat-msg', this.onChatMsg)
  }

  componentWillUnmount () {
    this.socket.off('chat-msg', this.onChatMsg)
  }

  onSend = () => {
    if (this.state.input !== '') {
      this.socket.emit('chat-msg', this.state.input)
      this.setState({ input: '' })
    }
  }

  render () {
    return (
      <div className='ChatWindow'>
        <table>
          <tbody>
            {this.state.history.map(msg => (
              <tr key={msg.id}>
                <td>{msg.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <input
          type='text'
          value={this.state.input}
          onChange={e => this.setState({ input: e.target.value })}
          onKeyPress={e => {
            if (e.which === 13) this.onSend()
          }}
        />
        <button onClick={this.onSend}>Send</button>
      </div>
    )
  }
}

class App extends Component {
  constructor (props) {
    super(props)

    this.state = {
      chat: { dummy: 'ABC', history: [] }
    }

    this.socket = io(config.server_uri)
  }

  render () {
    return (
      <div className='App'>
        <h1>Hello holo</h1>
        <p>Waiting music</p>
        <ChatWindow socket={this.socket} />
      </div>
    )
  }
}

export default App
