import React, { Component } from 'react'
import update from 'immutability-helper'
import './ChatWindow.css'
import { isPrintable } from './helper'

class ChatWindow extends Component {
  constructor (props) {
    super(props)

    this.state = {
      history: []
    }

    this.inputMsg = React.createRef()
  }

  componentDidMount () {
    this.props.socket.on('chat-msg', this.onChatMsg)
  }

  componentWillUnmount () {
    this.props.socket.off('chat-msg', this.onChatMsg)
  }

  onChatMsg = msg => {
    this.setState((state, props) =>
      update(state, { history: { $push: [msg] } })
    )
  }

  handleSubmit = e => {
    e.preventDefault()

    const body = this.inputMsg.current.value
    if (isPrintable(body)) {
      this.props.socket.emit('chat-msg', { body, tag: 'message' }, () => {
        this.inputMsg.current.value = ''
      })
    }
  }

  render () {
    return (
      <div className='ChatWindow'>
        <ChatHistory history={this.state.history} />
        <ChatPostForm
          handleSubmit={this.handleSubmit}
          inputMsg={this.inputMsg}
        />
      </div>
    )
  }
}

class ChatHistory extends Component {
  constructor (props) {
    super(props)
    this.lastDummyRow = React.createRef()
  }

  scrollToBottom () {
    this.lastDummyRow.current.scrollIntoView({ behavior: 'smooth' })
  }

  componentDidMount () {
    this.scrollToBottom()
  }

  componentDidUpdate () {
    this.scrollToBottom()
  }

  render () {
    return (
      <div className='ChatHistory'>
        {this.props.history.map(msg => (
          <div className='ChatHistoryRow' key={msg.mid}>
            {msg.tag === 'message' && (
              <div>
                <div className='ChatHistoryRowName'>{msg.name}</div>
                <div className='ChatHistoryRowBody'>{msg.body}</div>
              </div>
            )}
            {msg.tag === 'join' && (
              <div className='ChatHistoryRowNotification'>
                <div className='ChatHistoryRowName'>{msg.name}</div>
                <div className='ChatHistoryRowBody'>joined</div>
              </div>
            )}
            {msg.tag === 'leave' && (
              <div className='ChatHistoryRowNotification'>
                <div className='ChatHistoryRowName'>{msg.name}</div>
                <div className='ChatHistoryRowBody'>left</div>
              </div>
            )}
          </div>
        ))}
        <div className='ChatHistoryLastDummyRow' ref={this.lastDummyRow} />
      </div>
    )
  }
}

function ChatPostForm (props) {
  return (
    <div className='ChatPostForm'>
      <form onSubmit={props.handleSubmit}>
        <input type='text' ref={props.inputMsg} />
        <button type='submit'>Send</button>
      </form>
    </div>
  )
}

export default ChatWindow
