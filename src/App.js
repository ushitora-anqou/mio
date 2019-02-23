import React, { Component } from 'react'
import {
  BrowserRouter as Router,
  Route,
  Link,
  Switch,
  Redirect
} from 'react-router-dom'
import io from 'socket.io-client'
import './App.css'
import { config } from './config'
import { isPrintable, QuizRoomContext, roomStorage } from './helper'
import ChatWindow from './ChatWindow'
import SceneView from './SceneView'

import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { library } from '@fortawesome/fontawesome-svg-core'
import {
  faCircle,
  faPlayCircle,
  faStopCircle
} from '@fortawesome/free-regular-svg-icons'
import { faTimes } from '@fortawesome/free-solid-svg-icons'
library.add(faCircle, faTimes, faPlayCircle, faStopCircle)

function parseJSON (src) {
  try {
    return JSON.parse(src)
  } catch (err) {
    if (err instanceof 'SyntaxError') return null
    else throw err
  }
}

function newSocket () {
  return io(config.server_uri)
}

function UserList (props) {
  const myUser = props.users.find(user => user.uid === props.myUid)
  return (
    <div className='UserList'>
      {myUser && (
        <UserListEntry
          key={myUser.uid}
          user={myUser}
          className='UserListEntryMe'
        />
      )}
      {props.users.map(user => {
        if (user.uid === props.myUid) return null
        return <UserListEntry key={user.uid} user={user} />
      })}
    </div>
  )
}

function UserListEntry (props) {
  const user = props.user
  const online = user.online ? 'UserListEntryOnline' : 'UserListEntryOffline'
  const master = user.master ? 'UserListEntryMaster' : ''
  return (
    <div className={`UserListEntry ${online} ${master} ${props.className}`}>
      <span className='UserListEntryName'>{user.name}</span>
      {user.master || (
        <span className='UserListEntryMaru'>
          {user.maru}
          <FontAwesomeIcon icon={['far', 'circle']} />
        </span>
      )}
      {user.master || (
        <span className='UserListEntryPeke'>
          {user.peke}
          <FontAwesomeIcon icon='times' />
        </span>
      )}
    </div>
  )
}

class QuizRoom extends Component {
  constructor (props) {
    super(props)
    this.state = {
      socket: newSocket(),
      shouldWaitForReset: false,
      didAuth: false,
      established: null, // connecting
      round: null,
      users: []
    }
    this.roomid = props.roomid

    this.master = props.master
    this.uid = props.uid
    this.password = props.password
    this.socket = this.state.socket
  }

  componentDidMount () {
    this.socket.on('disconnect', this.onDisconnect)
    this.socket.on('auth', this.onAuth)
    this.socket.on('auth-result', this.onAuthResult)
    this.socket.on('quiz-info', this.onQuizInfo)
    this.socket.on('users', this.onUsers)

    roomStorage(this.roomid).setItem(
      'auth',
      JSON.stringify({
        uid: this.uid,
        master: this.master,
        password: this.password
      })
    )
  }

  componentWillUnmount () {
    this.socket.off('disconnect', this.onDisconnect)
    this.socket.off('auth', this.onAuth)
    this.socket.off('auth-result', this.onAuthResult)
    this.socket.off('quiz-info', this.onQuizInfo)
    this.socket.off('users', this.onUsers)
  }

  onDisconnect = () => {
    this.setState({ established: null })
  }

  onAuth = (x, done) => {
    done(this.uid, this.password, this.roomid)
  }

  onAuthResult = ({ status, shouldWaitForReset }) => {
    this.setState({
      established: status === 'ok',
      shouldWaitForReset,
      didAuth: true
    })
  }

  onQuizInfo = ({ round }) => {
    this.setState({ round })
  }

  onUsers = users => {
    this.setState({ users })
  }

  render () {
    if (this.state.established === false) {
      return <Route component={AuthFailed} />
    }

    return (
      <QuizRoomContext.Provider
        value={{
          established: this.state.established,
          numOfOnlineUsers: this.state.users.filter(user => user.online).length,
          sessionStorage: roomStorage(this.roomid)
        }}
      >
        <div className='QuizRoom'>
          <SceneView
            master={this.master}
            socket={this.socket}
            didAuth={this.state.didAuth}
            waitForReset={this.state.shouldWaitForReset}
            onProcessForAuth={this.handleProcessForAuth}
          />
          <div>
            <ConnectionStatus />
            <QuizStatus round={this.state.round} />
            <UserList users={this.state.users} myUid={this.uid} />
            <ChatWindow socket={this.socket} />
          </div>
        </div>
      </QuizRoomContext.Provider>
    )
  }

  handleProcessForAuth = () => {
    this.setState({ didAuth: false, shouldWaitForReset: false })
  }
}

class ConnectionStatus extends Component {
  static contextType = QuizRoomContext
  render () {
    return (
      <div className='ConnectionStatus'>
        {this.context.established === null && (
          <p>サーバへの接続が不安定です。しばらくお待ちください……</p>
        )}
      </div>
    )
  }
}

function QuizStatus (props) {
  return (
    <div className='QuizStatus'>
      <p>Round {props.round}</p>
    </div>
  )
}

const App = () => (
  <Router>
    <div className='App'>
      <h1>Mio - Intro Quiz App</h1>
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
    <p>（◕‿‿◕）下のリンクから部屋を作って、出題者になってよ</p>
    <Link to='/create-room'>あそぶ部屋を作る</Link>
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

const RoomNotFound = ({ location }) => (
  <div>
    <h2>お探しの部屋は見つかりませんでした</h2>
    <p>
      この部屋は削除されたか、もともと存在しませんでした。
      中に居る人が全員居なくなると部屋は自動的に削除されます。ゆるして
    </p>
    <p>
      <Link to='/create-room'>
        ここから部屋を作って新しいゲームを始めて下しあ。
      </Link>
    </p>
  </div>
)

const AuthFailed = ({ location }) => (
  <div>
    <h2>入室に失敗しました</h2>
    <p>
      この部屋が削除されたか、もしくは他のタブで既に入室しているなどの理由により、
      入室に失敗しました。ゆるして
    </p>
    <p>
      <Link to='/create-room'>
        新しい部屋を作成する場合はここを押して下しあ。
      </Link>
    </p>
  </div>
)

const Room = ({ match, location }) => {
  const roomid = match.params.roomid
  const props = location.state
    ? {
        master: location.state.master,
        uid: location.state.uid,
        password: location.state.password
      }
    : parseJSON(roomStorage(roomid).getItem('auth'))

  return props ? (
    <QuizRoom roomid={roomid} {...props} />
  ) : (
    <IssueAccount roomid={roomid} />
  )
}

class IssueAccount extends Component {
  constructor (props) {
    super(props)

    this.STAGE = { WAITING_INPUT: 0, CONNECTING: 1, REDIRECT: 2, ERROR: 3 }
    this.state = { state: null, stage: null }
    this.inputName = React.createRef()
    this.socket = newSocket()

    this.socket.emit('room-exists', { roomid: this.props.roomid }, exists => {
      this.setState({
        stage: exists ? this.STAGE.WAITING_INPUT : this.STAGE.ERROR
      })
    })
  }

  handleSubmit = e => {
    e.preventDefault()

    if (!isPrintable(this.inputName.current.value)) return

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
        this.socket.close()
        delete this.socket
      }
    )
    this.setState({ stage: this.STAGE.CONNECTING })
  }

  render () {
    switch (this.state.stage) {
      case this.STAGE.WAITING_INPUT:
        return (
          <div className='IssueAccount'>
            <h2>イントロクイズに招待されています</h2>
            <form onSubmit={this.handleSubmit}>
              <label>
                あなたの名前：
                <input type='text' ref={this.inputName} />
              </label>
              <button type='submit'>参加</button>
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

      case this.STAGE.ERROR:
        return <Route component={RoomNotFound} />

      default:
        return <div />
    }
  }
}

class CreateRoom extends Component {
  constructor (props) {
    super(props)

    this.state = {
      redirect: false,
      sending: false
    }

    this.inputName = React.createRef()
    this.socket = newSocket()
  }

  onSubmit = e => {
    e.preventDefault()

    if (!isPrintable(this.inputName.current.value)) return

    this.setState({ sending: true })

    this.socket.emit(
      'create-room',
      { masterName: this.inputName.current.value },
      (uid, password, roomid) => {
        this.uid = uid
        this.password = password
        this.roomid = roomid
        this.setState({ redirect: true })
        this.socket.close()
        delete this.socket
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
        <h2>あたらしい部屋を作成する</h2>
        <form onSubmit={this.onSubmit}>
          <label>
            あなたの名前：
            <input type='text' ref={this.inputName} />
          </label>
          <button type='submit' disabled={this.state.sending}>
            Submit
          </button>
        </form>
      </div>
    )
  }
}

export default App
