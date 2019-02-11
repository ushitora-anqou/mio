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

function fallback (fn, fallback) {
  try {
    return fn()
  } catch (e) {
    return fallback
  }
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
        <ChatPostForm onSubmit={this.handleSubmit} inputMsg={this.inputMsg} />
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

function setRedirect (self, pagename, state) {
  self.setState({
    redirect: { pathname: `/room/${self.props.roomid}/${pagename}`, state }
  })
}

class WaitMusic extends Component {
  constructor (props) {
    super(props)

    this.state = {
      redirect: null
    }

    this.inputMusicFile = React.createRef()
  }

  onQuizMusic = msg => {
    setRedirect(this, 'play-music', { music: msg.buf })
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
        this.props.socket.emit('quiz-music', { buf: buf }, () => {
          setRedirect(this, 'show-result', { judge: true })
        })
      })
      .catch(err => {
        alert("Can't read the file: not exists?")
      })
  }

  render () {
    if (this.state.redirect) return <Redirect to={{ ...this.state.redirect }} />

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
      playing: false,
      redirect: null
    }
    this.music = { buf: props.music }
  }

  onClickStart = () => {
    this.setState({ playing: true })
    this.audioCtx = new AudioContext()
    this.startTime = this.audioCtx.currentTime
  }

  onClickStop = () => {
    setRedirect(this, 'input-answer', {
      time: this.audioCtx.currentTime - this.startTime
    })
  }

  render () {
    if (this.state.redirect) return <Redirect to={{ ...this.state.redirect }} />

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

    this.state = {
      redirect: null
    }

    this.inputAnswer = React.createRef()
  }

  onSend = () => {
    this.props.socket.emit(
      'quiz-answer',
      { time: this.props.time, answer: this.inputAnswer.current.value },
      status => {
        setRedirect(this, 'show-result', { judge: false })
      }
    )
  }

  render () {
    if (this.state.redirect) return <Redirect to={{ ...this.state.redirect }} />

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
      entries: {},
      redirect: null
    }
  }

  componentDidMount () {
    this.props.socket.on('quiz-answer', this.onQuizAnswer)
    this.props.socket.on('quiz-result', this.onQuizResult)
  }

  componentWillUnmount () {
    this.props.socket.off('quiz-answer', this.onQuizAnswer)
    this.props.socket.off('quiz-result', this.onQuizResult)
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

  onSendJudge = () => {
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

  onSendDone = () => {
    setRedirect(this, 'wait-music', {})
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
    if (this.state.redirect) return <Redirect to={{ ...this.state.redirect }} />

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
            />
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

function ShowResultEntries (props) {
  const entries = props.entries
  const uids = Object.keys(entries).sort(
    (lhs_uid, rhs_uid) => entries[lhs_uid].time - entries[rhs_uid].time
  )

  return (
    <table>
      <tbody>
        {uids.map(uid => {
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
              ) : (
                <td />
              )}
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function SceneRoute (Scene, pageName, props) {
  return (
    <Route
      exact
      path={`/room/${props.roomid}/${pageName}`}
      render={({ location }) => <Scene {...props} {...location.state || {}} />}
    />
  )
}

function SceneView (props) {
  return (
    <div className='SceneView'>
      <Switch>
        {SceneRoute(PlayMusic, 'play-music', props)}
        {SceneRoute(InputAnswer, 'input-answer', props)}
        {SceneRoute(ShowResult, 'show-result', props)}
        {SceneRoute(WaitMusic, 'wait-music', props)}
        {SceneRoute(WaitMusic, '', props)}
        <Route component={NoMatch} />
      </Switch>
    </div>
  )
}

class QuizRoom extends Component {
  constructor (props) {
    super(props)
    this.state = {
      established: null // connecting
    }
    this.roomid = props.roomid

    this.master = props.master
    if (this.master) {
      this.uid = props.uid
      this.password = props.password
    }

    this.socket = newSocket()
    this.socket.on('auth', (x, cb) => {
      if (this.hasOwnProperty('uid')) {
        cb(this.uid, this.password, this.roomid)
        return
      }

      // get uid and password
      this.socket.emit(
        'issue-uid',
        { roomid: this.roomid },
        (uid, password) => {
          if (uid === null || password === null) {
            this.setState({ established: false }) // not found
            return
          }

          this.uid = uid
          this.password = password
          cb(uid, password, this.roomid)
        }
      )
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
        {this.state.established === null && (
          <div className='ConStatus'>
            <p>Connecting. Hang tight...</p>
          </div>
        )}
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
    <QuizRoom roomid={match.params.roomid} master={false} />
  )

class CreateRoom extends Component {
  constructor (props) {
    super(props)

    this.state = {
      redirect: false
    }

    this.socket = newSocket()
  }

  onSubmit = e => {
    e.preventDefault()
    this.socket.emit('create-room', {}, (uid, password, roomid) => {
      this.uid = uid
      this.password = password
      this.roomid = roomid
      this.setState({ redirect: true })
    })
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
          <button type='submit'>Submit</button>
        </form>
      </div>
    )
  }
}

export default App
