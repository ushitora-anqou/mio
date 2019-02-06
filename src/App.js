import React, { Component } from 'react'
import io from 'socket.io-client'
import update from 'immutability-helper'
import './App.css'
import { config } from './config'

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

const socket = io(config.server_uri)

class ChatWindow extends Component {
  constructor (props) {
    super(props)

    this.state = {
      history: [],
      input: ''
    }
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

  onSend = () => {
    if (this.state.input !== '') {
      socket.emit('chat-msg', this.state.input)
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
      socket.emit('quiz-music', { buf: buf })
    })

    changeScene(this, ShowResult, { judge: true })
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
  }

  onClickStop = () => {
    changeScene(this, InputAnswer, {})
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
    socket.emit('quiz-answer', { answer: this.inputAnswer.current.value })
    changeScene(this, ShowResult, { judge: false })
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
      entries: []
    }
  }

  componentDidMount () {
    socket.on('quiz-answer', this.onQuizAnswer)
    socket.on('quiz-result', this.onQuizResult)
  }

  componentWillUnmount () {
    socket.off('quiz-answer', this.onQuizAnswer)
    socket.off('quiz-result', this.onQuizResult)
  }

  onQuizAnswer = msg => {
    this.setState((state, props) => {
      return update(state, { entries: { $push: [msg] } })
    })
  }

  onQuizResult = msg => {
    this.setState({ entries: msg })
  }

  onSendJudge = () => {
    socket.emit('quiz-result', this.state.entries)
    this.setState({ judging: false })
  }

  onSendDone = () => {
    changeScene(this, WaitMusic, {})
  }

  render () {
    const entries = this.state.entries
    return (
      <div className='ShowResult'>
        {entries.length === 0 ? (
          <p>Waiting for the result</p>
        ) : (
          <div>
            <table>
              <tbody>
                {entries.map(entry => (
                  <tr key={entry.uid}>
                    <td>{entry.uid}</td>
                    <td>{entry.answer}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {this.state.judging && (
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
