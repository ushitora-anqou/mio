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
          <tr key={msg.id}>
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

function changeScene (self, SceneComponent, props) {
  self.props.changeScene(
    <SceneComponent
      changeScene={self.props.changeScene}
      master={self.props.master}
      socket={self.props.socket}
      {...props}
    />
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
    this.props.socket.on('quiz-music', this.onQuizMusic)
  }

  componentWillUnmount () {
    this.props.socket.off('quiz-music', this.onQuizMusic)
  }

  onSendMusic = e => {
    e.preventDefault()
    const file = this.inputMusicFile.current.files[0]

    readFileAsync(file)
      .then(buf => {
        this.props.socket.emit('quiz-music', { buf: buf }, status => {
          changeScene(this, ShowResult, { judge: true })
        })
      })
      .catch(err => {
        alert("Can't read the file: not exists?")
      })
  }

  render () {
    return (
      <div className='WaitMusic'>
        {this.props.master && (
          <form onSubmit={this.onSendMusic}>
            <input type='file' ref={this.inputMusicFile} />
            <button type='submit'>Send</button>
          </form>
        )}
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
    changeScene(this, InputAnswer, {
      time: this.audioCtx.currentTime - this.startTime
    })
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
    this.props.socket.emit(
      'quiz-answer',
      { time: this.props.time, answer: this.inputAnswer.current.value },
      status => {
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
    this.props.socket.on('quiz-answer', this.onQuizAnswer)
    this.props.socket.on('quiz-result', this.onQuizResult)
    this.props.socket.on('quiz-reset', this.onQuizReset)
  }

  componentWillUnmount () {
    this.props.socket.off('quiz-answer', this.onQuizAnswer)
    this.props.socket.off('quiz-result', this.onQuizResult)
    this.props.socket.off('quiz-reset', this.onQuizReset)
  }

  onQuizAnswer = msg => {
    this.setState((state, props) => {
      return update(state, {
        entries: {
          $merge: {
            [msg.uid]: { uid: msg.uid, time: msg.time, answer: msg.answer }
          }
        }
      })
    })
  }

  onQuizResult = msg => {
    this.setState({ entries: msg })
  }

  onQuizReset = () => {
    changeScene(this, WaitMusic, {})
  }

  onClickJudge = () => {
    this.props.socket.emit('quiz-result', this.state.entries, () => {
      this.setState({ judging: false })
    })
  }

  canSendJudge = () => {
    if (!this.state.judging) return false
    const entries = this.state.entries
    if (
      !Object.keys(entries).every(
        uid =>
          entries[uid].hasOwnProperty('time') &&
          entries[uid].hasOwnProperty('answer') &&
          entries[uid].hasOwnProperty('judge')
      )
    )
      return false
    return true
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

  onClickDone = () => {
    if (this.props.judge)
      this.props.socket.emit('quiz-reset', {}, () => {
        changeScene(this, WaitMusic, {})
      })
  }

  render () {
    return (
      <div className='ShowResult'>
        {isEmpty(this.state.entries) ? (
          <p>Waiting for the result</p>
        ) : (
          <div>
            <ShowResultEntries
              entries={this.state.entries}
              onClickOk={this.onClickOk}
              onClickNg={this.onClickNg}
              judging={this.state.judging}
            />
            {this.canSendJudge() && (
              <button onClick={this.onClickJudge}>Send</button>
            )}
            {!this.state.judging && this.props.judge && (
              <button onClick={this.onClickDone}>Done</button>
            )}
          </div>
        )}
      </div>
    )
  }
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
              <td>{entry.uid}</td>
              <td>{entry.time}</td>
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

class SceneView extends Component {
  constructor (props) {
    super(props)

    this.state = {
      scene: (
        <WaitMusic
          changeScene={this.changeScene}
          socket={this.props.socket}
          master={this.props.master}
        />
      )
    }
  }

  changeScene = scene => {
    this.setState({ scene: scene })
  }

  render () {
    return <div className='SceneView'>{this.state.scene}</div>
  }
}

class QuizRoom extends Component {
  constructor (props) {
    super(props)
    this.state = {
      established: null // connecting
    }
    this.roomid = props.roomid

    this.master = props.master
    this.uid = props.uid
    this.password = props.password

    this.socket = newSocket()
    this.socket.on('auth', (x, cb) => {
      cb(this.uid, this.password, this.roomid)
    })
    this.socket.on('auth-result', ({ status }) => {
      this.setState({ established: status === 'ok' })
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
        <SceneView
          master={this.master}
          socket={this.socket}
          roomid={this.roomid}
        />
        <ChatWindow socket={this.socket} />
      </div>
    )
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
      redirect: false
    }

    this.inputName = React.createRef()
    this.socket = newSocket()
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
