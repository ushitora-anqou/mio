import React, { Component } from 'react'
import {
  BrowserRouter as Router,
  Route,
  Link,
  Switch,
  Redirect
} from 'react-router-dom'
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

function newSocket () {
  return io(config.server_uri)
}

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
    this.props.socket.on('chat-msg', this.onChatMsg)
  }

  componentWillUnmount () {
    this.props.socket.off('chat-msg', this.onChatMsg)
  }

  handleSubmit = e => {
    e.preventDefault()

    const body = this.inputMsg.current.value
    if (body !== '') {
      this.props.socket.emit('chat-msg', body, status => {
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

function ChatHistory (props) {
  return (
    <table>
      <tbody>
        {props.history.map(msg => (
          <tr key={msg.mid}>
            <td>{msg.name}</td>
            <td>{msg.body}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ChatPostForm (props) {
  return (
    <form onSubmit={props.handleSubmit}>
      <input type='text' ref={props.inputMsg} />
      <button type='submit'>Send</button>
    </form>
  )
}

class WaitMusic extends Component {
  constructor (props) {
    super(props)

    this.inputMusicFile = React.createRef()
  }

  handleSubmit = async e => {
    e.preventDefault()

    const file = this.inputMusicFile.current.files[0]
    try {
      const buf = await readFileAsync(file)
      this.props.onSendMusic(buf)
    } catch (err) {
      alert("Can't read the file: not exists?")
    }
  }

  render () {
    return (
      <div className='WaitMusic'>
        {this.props.master && (
          <form onSubmit={this.handleSubmit}>
            <input type='file' ref={this.inputMusicFile} />
            <button type='submit'>Send</button>
          </form>
        )}
        <p>Waiting music</p>
      </div>
    )
  }
}

class PlayAndAnswer extends Component {
  constructor (props) {
    super(props)

    this.state = {
      scene: (
        <PlayMusic
          music={props.music}
          onClickStart={this.handleStartMusic}
          onClickStop={this.handleStopMusic}
        />
      ),
      time: null
    }
  }

  handleStartMusic = currentTime => {
    this.startTime = currentTime
  }

  handleStopMusic = currentTime => {
    this.setState({
      time: currentTime - this.startTime,
      scene: <InputAnswer onSubmit={this.handleSubmit} />
    })
  }

  handleSubmit = answer => {
    this.props.onAnswer(this.state.time, answer)
  }

  render () {
    return this.state.scene
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
    this.props.onClickStart(this.audioCtx.currentTime)
  }

  onClickStop = () => {
    this.props.onClickStop(this.audioCtx.currentTime)
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

  handleSubmit = e => {
    e.preventDefault()
    this.props.onSubmit(this.inputAnswer.current.value)
  }

  render () {
    return (
      <div className='InputAnswer'>
        <form onSubmit={this.handleSubmit}>
          <input type='text' ref={this.inputAnswer} />
          <button type='submit'>Send</button>
        </form>
      </div>
    )
  }
}

function SelectCorrectAnswer (props) {
  const answers = props.answers
  const canSendResult = () => {
    return Object.keys(answers).every(uid =>
      answers[uid].hasOwnProperty('judge')
    )
  }

  return (
    <div className='SelectCorrectAnswer'>
      {isEmpty(answers) ? (
        <p>Waiting for the answers</p>
      ) : (
        <div>
          <ShowResultEntries
            entries={answers}
            onClickOk={props.onCheckOk}
            onClickNg={props.onCheckNg}
            judging={true}
          />
          {canSendResult() && (
            <button onClick={props.onSendResult}>Send</button>
          )}
        </div>
      )}
    </div>
  )
}

function ShowResult (props) {
  return (
    <div className='ShowResult'>
      {isEmpty(props.answers) ? (
        <p>Waiting for the result</p>
      ) : (
        <div>
          <ShowResultEntries entries={props.answers} judging={false} />
          {props.master && <button onClick={props.onReset}>Reset</button>}{' '}
        </div>
      )}
    </div>
  )
}

function ShowResultEntries (props) {
  const entries = props.entries
  const uids = Object.keys(entries).sort(
    (lhs_uid, rhs_uid) => entries[lhs_uid].time - entries[rhs_uid].time
  )

  return (
    <table className='ShowResultEntries'>
      <tbody>
        {uids.map(uid => {
          const entry = entries[uid]
          return (
            <tr
              key={entry.uid}
              className={
                entry.judge === undefined
                  ? ''
                  : entry.judge
                  ? 'CorrectRow'
                  : 'WrongRow'
              }
            >
              <td>{entry.name}</td>
              <td>{entry.time.toFixed(4)}</td>
              <td>{entry.answer}</td>
              {props.judging && (
                <td>
                  <label>
                    <input
                      type='radio'
                      name={entry.uid}
                      checked={entry.judge === true}
                      onChange={e => {
                        return props.onClickOk(entry.uid)
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
                        return props.onClickNg(entry.uid)
                      }}
                    />
                    <span role='img' aria-label='x'>
                      ❌
                    </span>
                  </label>
                </td>
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function WaitReset (props) {
  return (
    <div className='WaitReset'>
      <p>Waiting for the current ongoing game to finish... </p>
    </div>
  )
}

class SceneView extends Component {
  constructor (props) {
    super(props)

    this.SCENE = {
      WAIT_MUSIC: 0,
      PLAY_AND_ANSWER: 1,
      SELECT_CORRECT_ANSWER: 2,
      SHOW_RESULT: 3,
      WAIT_RESET: 4
    }

    this.socket = props.socket
    this.state = {
      scene: {
        kind: this.SCENE.WAIT_MUSIC
      }
    }
  }

  componentDidUpdate () {
    if (
      this.props.waitForReset &&
      this.state.scene.kind !== this.SCENE.WAIT_RESET
    )
      this._changeScene(this.SCENE.WAIT_RESET)
  }

  render () {
    const S = this.SCENE
    let content = null

    switch (this.state.scene.kind) {
      case S.WAIT_MUSIC:
        content = this.props.master ? (
          <WaitMusic master={true} onSendMusic={this.handleSendMusic} />
        ) : (
          <WaitMusic master={false} />
        )
        break

      case S.PLAY_AND_ANSWER:
        content = (
          <PlayAndAnswer
            music={this.state.scene.music}
            onAnswer={this.handleInputAnswer}
          />
        )
        break

      case S.SELECT_CORRECT_ANSWER:
        content = (
          <SelectCorrectAnswer
            onCheckOk={key => this.handleCheckAnswer(key, true)}
            onCheckNg={key => this.handleCheckAnswer(key, false)}
            onSendResult={this.handleSendAnswerResult}
            answers={this.state.scene.answers}
          />
        )
        break

      case S.SHOW_RESULT:
        content = this.props.master ? (
          <ShowResult
            answers={this.state.scene.answers}
            master={true}
            onReset={this.handleResetResult}
          />
        ) : (
          <ShowResult answers={this.state.scene.answers} master={false} />
        )
        break

      case S.WAIT_RESET:
        content = <WaitReset />
        break
    }

    return <div className='SceneView'>{content}</div>
  }

  _changeScene (kind, data = {}) {
    this.setState({ scene: { kind, ...data } })
  }

  _emitAndChangeScene (eventName, arg, sceneKind, sceneData = {}) {
    this.socket.emit(eventName, arg, () => {
      this._changeScene(sceneKind, sceneData)
    })
  }

  componentDidMount () {
    this._changeScene(this.SCENE.WAIT_MUSIC)

    this.socket.on('quiz-music', this.onQuizMusic)
    this.socket.on('quiz-answer', this.onQuizAnswer)
    this.socket.on('quiz-result', this.onQuizResult)
    this.socket.on('quiz-reset', this.onQuizReset)
  }

  componentWillUnmount () {
    this.socket.off('quiz-music', this.onQuizMusic)
    this.socket.off('quiz-answer', this.onQuizAnswer)
    this.socket.off('quiz-result', this.onQuizResult)
    this.socket.off('quiz-reset', this.onQuizReset)
  }

  // Handler for scenes' events

  handleSendMusic = music => {
    this._emitAndChangeScene(
      'quiz-music',
      { buf: music },
      this.SCENE.SELECT_CORRECT_ANSWER,
      { answers: {} }
    )
  }

  handleCheckAnswer = (key, correct) => {
    this.setState((state, props) => ({
      scene: update(state.scene, {
        answers: { [key]: { judge: { $set: correct } } }
      })
    }))
  }

  handleSendAnswerResult = () => {
    const answers = this.state.scene.answers
    this._emitAndChangeScene('quiz-result', answers, this.SCENE.SHOW_RESULT, {
      answers
    })
  }

  handleResetResult = () => {
    this._emitAndChangeScene('quiz-reset', {}, this.SCENE.WAIT_MUSIC)
  }

  handleInputAnswer = (time, answer) => {
    this._emitAndChangeScene(
      'quiz-answer',
      { time, answer },
      this.SCENE.SHOW_RESULT,
      { answers: {} }
    )
  }

  // Handlers for socket
  onQuizMusic = msg => {
    this._changeScene(this.SCENE.PLAY_AND_ANSWER, { music: msg.buf })
  }

  onQuizAnswer = msg => {
    // append answer
    this.setState((state, props) => ({
      scene: update(state.scene, {
        answers: { $merge: { [msg.uid]: msg } }
      })
    }))
  }

  onQuizResult = msg => {
    this._changeScene(this.SCENE.SHOW_RESULT, { answers: msg })
  }

  onQuizReset = () => {
    this.props.onQuizReset()
    this._changeScene(this.SCENE.WAIT_MUSIC)
  }
}

class QuizRoom extends Component {
  constructor (props) {
    super(props)
    this.state = {
      socket: newSocket(),
      shouldWaitForReset: false,
      established: null // connecting
    }
    this.roomid = props.roomid

    this.master = props.master
    this.uid = props.uid
    this.password = props.password

    this.socket = this.state.socket
    this.socket.on('auth', (x, cb) => {
      cb(this.uid, this.password, this.roomid)
    })
    this.socket.on('auth-result', ({ status, shouldWaitForReset }) => {
      this.setState({ established: status === 'ok', shouldWaitForReset })
    })
    this.socket.on('disconnect', () => {
      this.setState({ established: null })
    })
  }

  render () {
    if (this.state.established === false) {
      return <Route component={NoMatch} />
    }

    return (
      <div className='QuizRoom'>
        <h1>Hello holo</h1>
        <ConnectionStatus established={this.state.established} />
        {this.state.established && (
          <SceneView
            master={this.master}
            socket={this.socket}
            roomid={this.roomid}
            waitForReset={this.state.shouldWaitForReset}
            onQuizReset={this.handleQuizReset}
          />
        )}
        <ChatWindow socket={this.socket} />
      </div>
    )
  }

  handleQuizReset = () => {
    this.setState({ shouldWaitForReset: false })
  }
}

function ConnectionStatus (props) {
  return (
    <div className='ConnectionStatus'>
      {props.established === null && (
        <p>Connecting to the server. Please hang tight...</p>
      )}
    </div>
  )
}

const App = () => (
  <Router>
    <div className='App'>
      <Switch>
        <Route exact path='/' component={Home} />
        <Route exact path='/create-room' component={CreateRoom} />
        <Route path='/room/:roomid' component={Room} />
        <Route component={NoMatch} />
      </Switch>
    </div>
  </Router>
)

const Home = () => (
  <div>
    <h1>Hello holo</h1>
    <Link to='/create-room'>Create a room to play</Link>
  </div>
)

const NoMatch = ({ location }) => (
  <div>
    <h1>404 Not Found</h1>
    <p>
      <code>{location.pathname}</code> not found
    </p>
  </div>
)

const Room = ({ match, location }) =>
  location.state ? (
    <QuizRoom roomid={match.params.roomid} {...location.state} />
  ) : (
    <IssueAccount roomid={match.params.roomid} />
  )

class IssueAccount extends Component {
  constructor (props) {
    super(props)

    this.STAGE = { WAITING_INPUT: 0, CONNECTING: 1, REDIRECT: 2, ERROR: 3 }
    this.state = { state: null, stage: this.STAGE.WAITING_INPUT }
    this.inputName = React.createRef()
  }

  handleSubmit = e => {
    e.preventDefault()

    this.socket = newSocket()
    this.socket.emit(
      'issue-uid',
      { name: this.inputName.current.value, roomid: this.props.roomid },
      (uid, password) => {
        if (uid === null || password === null)
          this.setState({ stage: this.STAGE.ERROR })
        else
          this.setState({
            stage: this.STAGE.REDIRECT,
            state: { uid, password, master: false }
          })
      }
    )
    this.setState({ stage: this.STAGE.CONNECTING })
  }

  render () {
    switch (this.state.stage) {
      case this.STAGE.WAITING_INPUT:
        return (
          <div className='IssueAccount'>
            <form onSubmit={this.handleSubmit}>
              <label>
                Name
                <input type='text' ref={this.inputName} />
              </label>
              <button type='submit'>Submit</button>
            </form>
          </div>
        )

      case this.STAGE.CONNECTING:
        return (
          <div className='IssueAccount'>
            <p>Connecting to the server...</p>
          </div>
        )

      case this.STAGE.REDIRECT:
        return (
          <Redirect
            to={{
              pathname: `/room/${this.props.roomid}`,
              state: this.state.state
            }}
          />
        )

      default:
        return <Route component={NoMatch} />
    }
  }
}

class CreateRoom extends Component {
  constructor (props) {
    super(props)

    this.state = {
      socket: newSocket(),
      redirect: false
    }

    this.inputName = React.createRef()
    this.socket = this.state.socket
  }

  onSubmit = e => {
    e.preventDefault()
    this.socket.emit(
      'create-room',
      { masterName: this.inputName.current.value },
      (uid, password, roomid) => {
        this.uid = uid
        this.password = password
        this.roomid = roomid
        this.setState({ redirect: true })
      }
    )
  }

  render () {
    if (this.state.redirect)
      return (
        <Redirect
          to={{
            pathname: '/room/' + this.roomid,
            state: { uid: this.uid, password: this.password, master: true }
          }}
        />
      )

    return (
      <div className='CreateRoom'>
        <form onSubmit={this.onSubmit}>
          <label>
            Name
            <input type='text' ref={this.inputName} />
          </label>
          <button type='submit'>Submit</button>
        </form>
      </div>
    )
  }
}

export default App
