import React, { Component } from 'react'
import io from 'socket.io-client'
import update from 'immutability-helper'
import './App.css'
import { config } from './config'

const AudioContext = window.AudioContext || window.webkitAudioContext

// thanks to https://simon-schraeder.de/posts/filereader-async/
function readFileAsync (file) {
  return new Promise((resolve, reject) => {
    let reader = new FileReader()

    reader.onload = () => {
      resolve(reader.result)
    }

    reader.onerror = reject

    reader.readAsArrayBuffer(file)
  })
}

function isEmpty (obj) {
  return Object.keys(obj).length === 0
}

const socket = io(config.server_uri)

class ChatWindow extends Component {
  constructor (props) {
    super(props)

    this.state = {
      history: []
    }

    this.inputMsg = React.createRef()
  }

  onChatMsg = msg => {
    this.setState((state, props) =>
      update(state, { history: { $push: [msg] } })
    )
  }

  componentDidMount () {
    socket.on('chat-msg', this.onChatMsg)
  }

  componentWillUnmount () {
    socket.off('chat-msg', this.onChatMsg)
  }

  handleSubmit = e => {
    e.preventDefault()

    const body = this.inputMsg.current.value
    if (body !== '') {
      socket.emit('chat-msg', body, () => {
        this.inputMsg.current.value = ''
      })
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
        <form onSubmit={this.handleSubmit}>
          <input type='text' ref={this.inputMsg} />
          <button type='submit'>Send</button>
        </form>
      </div>
    )
  }
}

function changeScene (self, SceneComponent, props) {
  self.props.changeScene(
    <SceneComponent changeScene={self.props.changeScene} {...props} />
  )
}

class WaitMusic extends Component {
  constructor (props) {
    super(props)

    this.inputMusicFile = React.createRef()
  }

  onQuizMusic = msg => {
    changeScene(this, PlayMusic, { music: msg.buf })
  }

  componentDidMount () {
    socket.on('quiz-music', this.onQuizMusic)
  }

  componentWillUnmount () {
    socket.off('quiz-music', this.onQuizMusic)
  }

  onClickSendMusic = () => {
    const file = this.inputMusicFile.current.files[0]

    readFileAsync(file).then(buf => {
      socket.emit('quiz-music', { buf: buf }, () => {
        changeScene(this, ShowResult, { judge: true })
      })
    })
  }

  render () {
    return (
      <div className='WaitMusic'>
        <input type='file' ref={this.inputMusicFile} />
        <button onClick={this.onClickSendMusic}>Send</button>
        <p>Waiting music</p>
      </div>
    )
  }
}

class PlayMusic extends Component {
  constructor (props) {
    super(props)

    this.state = {
      playing: false
    }
    this.music = { buf: props.music }
  }

  onClickStart = () => {
    this.setState({ playing: true })
    this.audioCtx = new AudioContext()
    this.startTime = this.audioCtx.currentTime
  }

  onClickStop = () => {
    socket.emit(
      'quiz-time',
      {
        time: this.audioCtx.currentTime - this.startTime
      },
      () => {
        changeScene(this, InputAnswer, {})
      }
    )
  }

  render () {
    return (
      <div className='PlayMusic'>
        {this.state.playing ? (
          <button onClick={this.onClickStop}>Stop</button>
        ) : (
          <button onClick={this.onClickStart}>Start</button>
        )}
      </div>
    )
  }
}

class InputAnswer extends Component {
  constructor (props) {
    super(props)

    this.inputAnswer = React.createRef()
  }

  onSend = () => {
    socket.emit(
      'quiz-answer',
      { answer: this.inputAnswer.current.value },
      () => {
        changeScene(this, ShowResult, { judge: false })
      }
    )
  }

  render () {
    return (
      <div className='InputAnswer'>
        <input type='text' ref={this.inputAnswer} />
        <button onClick={this.onSend}>Send</button>
      </div>
    )
  }
}

class ShowResult extends Component {
  constructor (props) {
    super(props)

    this.state = {
      judging: props.judge,
      entries: {}
    }
  }

  componentDidMount () {
    socket.on('quiz-time', this.onQuizTime)
    socket.on('quiz-answer', this.onQuizAnswer)
    socket.on('quiz-result', this.onQuizResult)
  }

  componentWillUnmount () {
    socket.off('quiz-time', this.onQuizTime)
    socket.off('quiz-answer', this.onQuizAnswer)
    socket.off('quiz-result', this.onQuizResult)
  }

  onQuizTime = msg => {
    this.setState((state, props) => {
      return update(state, {
        entries: { $merge: { [msg.uid]: { uid: msg.uid, time: msg.time } } }
      })
    })
  }

  onQuizAnswer = msg => {
    this.setState((state, props) => {
      return update(state, {
        entries: { [msg.uid]: { $merge: { answer: msg.answer } } }
      })
    })
  }

  onQuizResult = msg => {
    this.setState({ entries: msg })
  }

  onSendJudge = () => {
    socket.emit('quiz-result', this.state.entries, () => {
      this.setState({ judging: false })
    })
  }

  canSendJudge = () => {
    if (!this.state.judging) return false
    const entries = this.state.entries
    if (
      !Object.keys(entries).every(
        uid =>
          entries[uid].hasOwnProperty('answer') &&
          entries[uid].hasOwnProperty('judge')
      )
    )
      return false
    return true
  }

  onSendDone = () => {
    changeScene(this, WaitMusic, {})
  }

  onClickOk = uid => {
    if (this.state.judging)
      this.setState((state, props) =>
        update(state, { entries: { [uid]: { judge: { $set: true } } } })
      )
  }

  onClickNg = uid => {
    if (this.state.judging)
      this.setState((state, props) =>
        update(state, { entries: { [uid]: { judge: { $set: false } } } })
      )
  }

  render () {
    const entries = this.state.entries
    return (
      <div className='ShowResult'>
        {isEmpty(entries) ? (
          <p>Waiting for the result</p>
        ) : (
          <div>
            <table>
              <tbody>
                {Object.keys(entries)
                  .sort(
                    (lhs_uid, rhs_uid) =>
                      entries[lhs_uid].time - entries[rhs_uid].time
                  )
                  .map(uid => {
                    const entry = entries[uid]
                    return (
                      <tr key={entry.uid}>
                        <td>{entry.uid}</td>
                        <td>{entry.time}</td>
                        <td>{entry.answer}</td>
                        {entry.hasOwnProperty('time') &&
                        entry.hasOwnProperty('answer') ? (
                          <td>
                            <label>
                              <input
                                type='radio'
                                name={entry.uid}
                                checked={entry.judge === true}
                                onChange={e => {
                                  return this.onClickOk(entry.uid)
                                }}
                              />
                              <span role='img' aria-label='check'>
                                ✔️
                              </span>
                            </label>
                            <label>
                              <input
                                type='radio'
                                name={entry.uid}
                                checked={entry.judge === false}
                                onChange={e => {
                                  return this.onClickNg(entry.uid)
                                }}
                              />
                              <span role='img' aria-label='x'>
                                ❌
                              </span>
                            </label>
                          </td>
                        ) : (
                          <td />
                        )}
                      </tr>
                    )
                  })}
              </tbody>
            </table>
            {this.canSendJudge() && (
              <button onClick={this.onSendJudge}>Send</button>
            )}
            {!this.state.judging && (
              <button onClick={this.onSendDone}>Done</button>
            )}
          </div>
        )}
      </div>
    )
  }
}

class SceneView extends Component {
  constructor (props) {
    super(props)

    this.state = {
      scene: <WaitMusic changeScene={this.changeScene} />
    }
  }

  changeScene = scene => {
    this.setState({ scene: scene })
  }

  render () {
    return <div className='SceneView'>{this.state.scene}</div>
  }
}

class App extends Component {
  constructor (props) {
    super(props)
    this.state = {}
  }

  render () {
    return (
      <div className='App'>
        <h1>Hello holo</h1>
        <SceneView />
        <ChatWindow />
      </div>
    )
  }
}

export default App
