import React, { Component } from 'react'
import { Route, Link } from 'react-router-dom'
import update from 'immutability-helper'
import './QuizRoom.css'
import { QuizRoomContext, isPrintable, roomStorage, newSocket } from './helper'
import ChatWindow from './ChatWindow'
import SceneView from './SceneView'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'

function reversed (ary) {
  return ary.slice().reverse()
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
      point: null,
      users: [],
      quizHistory: []
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

  onQuizInfo = ({ round, correctPoint, wrongPoint }) => {
    this.setState({
      round,
      point: { correct: correctPoint, wrong: wrongPoint }
    })
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
          roomStorage: roomStorage(this.roomid)
        }}
      >
        <div className='QuizRoom'>
          <SceneView
            master={this.master}
            socket={this.socket}
            didAuth={this.state.didAuth}
            waitForReset={this.state.shouldWaitForReset}
            onProcessForAuth={this.handleProcessForAuth}
            onQuizReset={this.handleQuizReset}
          />
          <div>
            <ConnectionStatus />
            <QuizStatus round={this.state.round} point={this.state.point} />
            {this.master && <AllotmentEditor socket={this.socket} />}
            <QuizHistory history={this.state.quizHistory} />
            <UserList users={this.state.users} myUid={this.uid} />
            {this.master && (
              <ScoreEditor socket={this.socket} users={this.state.users} />
            )}
            <ChatWindow socket={this.socket} />
          </div>
        </div>
      </QuizRoomContext.Provider>
    )
  }

  handleProcessForAuth = () => {
    this.setState({ didAuth: false, shouldWaitForReset: false })
  }

  handleQuizReset = correctAnswer => {
    this.setState((state, props) => ({
      quizHistory: update(state.quizHistory, {
        $push: [{ round: this.state.round, answer: correctAnswer }]
      })
    }))
  }
}

function QuizHistory (props) {
  return (
    <div className='QuizHistory'>
      {reversed(props.history).map(({ round, answer }) => (
        <div key={round}>
          <span className='QuizHistoryEntryRound'>Round {round}</span>
          <span className='QuizHistoryEntryAnswer'>{answer}</span>
        </div>
      ))}
    </div>
  )
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
      {!user.master && (
        <span className='UserListEntryScore'>{user.points}</span>
      )}
    </div>
  )
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
      <span>Round {props.round}</span>
      {props.point && (
        <>
          <span>
            {props.point.correct}点／
            <FontAwesomeIcon icon={['far', 'circle']} />
          </span>
          <span>
            {props.point.wrong}点／
            <FontAwesomeIcon icon='times' />
          </span>{' '}
        </>
      )}
    </div>
  )
}

function AllotmentEditor (props) {
  const [sending, setSending] = React.useState(false)
  const inputCorrect = React.useRef(null)
  const inputWrong = React.useRef(null)

  const handleSubmit = React.useCallback(e => {
    e.preventDefault()

    // treat blank value as 0
    const correctPoint = Number(inputCorrect.current.value)
    const wrongPoint = Number(inputWrong.current.value)

    setSending(true)

    props.socket.emit('change-allotment', { correctPoint, wrongPoint }, () => {
      // clear
      inputCorrect.current.value = ''
      inputWrong.current.value = ''
      setSending(false)
    })
  }, [])

  return (
    <div className='AllotmentEditor'>
      <form onSubmit={handleSubmit}>
        <input type='number' ref={inputCorrect} placeholder='○' />
        <input type='number' ref={inputWrong} placeholder='×' />
        <button disabled={sending}>配点変更</button>
      </form>
    </div>
  )
}

function ScoreEditor (props) {
  const [sending, setSending] = React.useState(false)
  const selectUser = React.useRef(null)
  const inputCorrect = React.useRef(null)
  const inputWrong = React.useRef(null)
  const inputPoints = React.useRef(null)

  const handleSubmit = React.useCallback(e => {
    e.preventDefault()

    const uid = selectUser.current.value
    // treat blank value as 0
    const maru = Number(inputCorrect.current.value)
    const peke = Number(inputWrong.current.value)
    const points = Number(inputPoints.current.value)
    if (!isPrintable(uid)) return

    setSending(true)

    props.socket.emit('change-score', { uid, maru, peke, points }, () => {
      // clear
      selectUser.current.value = ''
      inputCorrect.current.value = ''
      inputWrong.current.value = ''
      inputPoints.current.value = ''
      setSending(false)
    })
  }, [])

  return (
    <div className='ScoreEditor'>
      <form onSubmit={handleSubmit}>
        <select ref={selectUser}>
          {props.users.map(user =>
            user.master ? null : (
              <option key={user.uid} value={user.uid}>
                {user.name}
              </option>
            )
          )}
        </select>
        <input type='number' ref={inputCorrect} placeholder='○' />
        <input type='number' ref={inputWrong} placeholder='×' />
        <input type='number' ref={inputPoints} placeholder='点数' />
        <button disabled={sending}>得点変更</button>
      </form>
    </div>
  )
}

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

export default QuizRoom
