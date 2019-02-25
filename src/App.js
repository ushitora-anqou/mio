import React, { Component } from 'react'
import {
  BrowserRouter as Router,
  Route,
  Link,
  Switch,
  Redirect
} from 'react-router-dom'
import './App.css'
import { isPrintable, roomStorage, newSocket } from './helper'
import QuizRoom from './QuizRoom'

// prepare font-awesome icons
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { library } from '@fortawesome/fontawesome-svg-core'
import {
  faCircle,
  faPlayCircle,
  faStopCircle
} from '@fortawesome/free-regular-svg-icons'
import { faTimes } from '@fortawesome/free-solid-svg-icons'
library.add(faCircle, faTimes, faPlayCircle, faStopCircle)

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
    this.inputCorrectPoint = React.createRef()
    this.inputWrongPoint = React.createRef()
    this.socket = newSocket()
  }

  onSubmit = e => {
    e.preventDefault()

    if (!isPrintable(this.inputName.current.value)) return
    const correctPoint = Number(this.inputCorrectPoint.current.value)
    const wrongPoint = Number(this.inputWrongPoint.current.value)
    if (!correctPoint || !wrongPoint) return

    this.setState({ sending: true })

    this.socket.emit(
      'create-room',
      {
        masterName: this.inputName.current.value,
        correctPoint,
        wrongPoint
      },
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
          <label>あなたの名前：</label>
          <input type='text' ref={this.inputName} />
          <label>
            <FontAwesomeIcon icon={['far', 'circle']} />
            正答に与える得点：
          </label>
          <input type='number' ref={this.inputCorrectPoint} />
          <label>
            <FontAwesomeIcon icon='times' />
            誤答に与える得点：
          </label>
          <input type='number' ref={this.inputWrongPoint} />
          <button type='submit' disabled={this.state.sending}>
            送信
          </button>
        </form>
      </div>
    )
  }
}

function parseJSON (src) {
  try {
    return JSON.parse(src)
  } catch (err) {
    if (err instanceof 'SyntaxError') return null
    else throw err
  }
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

export default App
