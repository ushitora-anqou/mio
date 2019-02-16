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

const lamejs = require('lamejs')
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

async function extractHeadOfMusic (
  encodedBuf,
  seconds,
  channels,
  sampleRate,
  kbps
) {
  // get PCM wave of the head of the music
  const audioCtx = new AudioContext()
  const decodedBuf = await audioCtx.decodeAudioData(encodedBuf)
  const offlineCtx = new OfflineAudioContext(
    channels,
    sampleRate * seconds,
    sampleRate
  )
  const source = offlineCtx.createBufferSource()
  source.buffer = decodedBuf
  source.connect(offlineCtx.destination)
  source.start()
  const renderedBuf = await offlineCtx.startRendering()

  // convert PCM to MP3 by using lamejs
  const float2int = buf => Int16Array.from(buf, x => x * 0x8000)
  const leftSamples = float2int(renderedBuf.getChannelData(0))
  const rightSamples = float2int(renderedBuf.getChannelData(1))
  const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps)
  const data = []
  data.push(Buffer.from(mp3encoder.encodeBuffer(leftSamples, rightSamples)))
  data.push(Buffer.from(mp3encoder.flush()))
  return Buffer.concat(data)
}

function isEmpty (obj) {
  return Object.keys(obj).length === 0
}

function isPrintable (str) {
  return !/^[ \t\n　]*$/.test(str)
}

function newSocket () {
  return io(config.server_uri)
}

const SocketContext = React.createContext()

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

class WaitMusic extends Component {
  static contextType = SocketContext

  constructor (props) {
    super(props)

    this.state = { sending: false }

    this.inputMusicFile = React.createRef()
    this.urlRef = React.createRef()
  }

  handleSubmit = async e => {
    e.preventDefault()
    this.setState({ sending: true })

    let musicBuf = null
    try {
      if (this.inputMusicFile.current.files.length !== 1)
        throw new Error('The number of specified files should be one.')
      const file = this.inputMusicFile.current.files[0]
      if (file.size > 20000000) throw new Error('The file is too big.')
      musicBuf = await extractHeadOfMusic(
        await readFileAsync(file),
        15,
        2,
        44100,
        128
      )
      if (!musicBuf)
        new Error(
          'Unexpected error occured in conversion of the music file to MP3.'
        )
    } catch (err) {
      this.props.onFailToLoad(err)
      this.setState({ sending: false })
    }

    if (musicBuf) {
      this.props.onSendMusic(musicBuf)
      this.timerID = setTimeout(() => {
        this.setState({ sending: false })
      }, 2000)
    }
  }

  componentWillUnmount () {
    if (this.timerID) clearInterval(this.timerID)
  }

  render () {
    return (
      <div className='WaitMusic'>
        {this.props.master && (
          <div>
            <h2>問題曲を出題する</h2>
            <form onSubmit={this.handleSubmit}>
              <input type='file' accept='audio/*' ref={this.inputMusicFile} />
              <button
                type='submit'
                disabled={this.state.sending || !this.context.established}
              >
                出題
              </button>
            </form>
          </div>
        )}
        {!this.props.master && (
          <div>
            <p>問題曲が届くのを待っています……</p>
          </div>
        )}

        <div>
          <label>
            クイズの参加者にはこのページのURLを共有して下さい：
            <input
              type='text'
              value={window.location.href}
              ref={this.urlRef}
              readonly={true}
            />
          </label>
          <button
            onClick={() => {
              this.urlRef.current.select()
              document.execCommand('Copy')
            }}
          >
            URLをコピーする
          </button>
        </div>
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
          onMusicStart={this.handleStartMusic}
          onMusicStop={this.handleStopMusic}
          onFailToLoad={props.onFailToLoad}
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
      playing: false,
      music_buf: null
    }
    this.audioCtx = new AudioContext()
    this.audioCtx
      .decodeAudioData(props.music)
      .then(buf => {
        this.setState({ music_buf: buf })
      })
      .catch(err => {
        // Can't load the music file.
        // TODO: What is the BA?
        props.onFailToLoad()
      })
  }

  onClickStart = () => {
    if (this.state.music_buf) {
      this.setState({ playing: true })
      this.props.onMusicStart(this.audioCtx.currentTime)

      // play the music
      this.source = this.audioCtx.createBufferSource()
      this.source.buffer = this.state.music_buf
      this.source.connect(this.audioCtx.destination)
      this.source.onended = () => {
        this.props.onMusicStop(this.audioCtx.currentTime)
      }
      this.source.start(0)
    }
  }

  onClickStop = () => {
    this.source.stop()
  }

  render () {
    return (
      <div className='PlayMusic'>
        {this.state.playing ? (
          <button onClick={this.onClickStop}>停止</button>
        ) : (
          <button
            onClick={this.onClickStart}
            disabled={this.state.music_buf ? false : true}
          >
            再生
          </button>
        )}
      </div>
    )
  }
}

class InputAnswer extends Component {
  static contextType = SocketContext

  constructor (props) {
    super(props)

    this.state = { sending: false }

    this.inputAnswer = React.createRef()
  }

  handleSubmit = e => {
    e.preventDefault()
    if (!isPrintable(this.inputAnswer.current.value)) return
    this.props.onSubmit(this.inputAnswer.current.value)
    this.setState({ sending: true })
  }

  render () {
    return (
      <div className='InputAnswer'>
        <form onSubmit={this.handleSubmit}>
          <label>
            答え：
            <input type='text' ref={this.inputAnswer} />
          </label>
          <button
            type='submit'
            disabled={this.state.sending || !this.context.established}
          >
            送信
          </button>
        </form>
      </div>
    )
  }
}

class SelectCorrectAnswer extends Component {
  static contextType = SocketContext

  constructor (props) {
    super(props)

    this.state = { sending: false }
  }

  handleSend = () => {
    this.setState({ sending: true })
    this.props.onSendResult()
  }

  render () {
    const answers = this.props.answers
    const canSendResult = () => {
      return Object.keys(answers).every(uid =>
        answers[uid].hasOwnProperty('judge')
      )
    }

    return (
      <div className='SelectCorrectAnswer'>
        <h2>採点</h2>
        {isEmpty(answers) ? (
          <div>
            <p>回答を待っています……</p>
            <button onClick={this.props.onReset}>次のゲームへ</button>
          </div>
        ) : (
          <div>
            <ShowResultEntries
              entries={answers}
              onClickOk={this.props.onCheckOk}
              onClickNg={this.props.onCheckNg}
              judging={true}
            />
            {canSendResult() && (
              <button
                onClick={this.props.onSendResult}
                disabled={this.state.sending || !this.context.established}
              >
                採点終了
              </button>
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
    <div className='ShowResultEntries'>
      {uids.map(uid => {
        const entry = entries[uid]
        return (
          <div
            key={entry.uid}
            className={
              entry.judge === undefined
                ? ''
                : entry.judge
                ? 'CorrectRow'
                : 'WrongRow'
            }
          >
            <div className='ShowResultEntriesColumn ShowResultEntriesColumnName'>
              {entry.name}
            </div>
            <div className='ShowResultEntriesColumn ShowResultEntriesColumnTime'>
              {entry.time.toFixed(4)}
            </div>
            <div className='ShowResultEntriesColumn ShowResultEntriesColumnAnswer'>
              {entry.answer}
            </div>
            {props.judging && (
              <div className='ShowResultEntriesColumn'>
                <div className='ShowResultEntriesColumnCheck'>
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
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

class ShowResult extends Component {
  static contextType = SocketContext

  constructor (props) {
    super(props)

    this.state = { sending: false }
  }

  handleReset = () => {
    this.setState({ sending: true })
    this.props.onReset()
  }

  render () {
    return (
      <div className='ShowResult'>
        <h2>採点結果</h2>
        {isEmpty(this.props.answers) ? (
          <p>採点が終了するのを待っています……</p>
        ) : (
          <div>
            <ShowResultEntries entries={this.props.answers} judging={false} />
            {this.props.master && (
              <button
                onClick={this.props.onReset}
                disabled={this.state.sending || !this.context.established}
              >
                次のゲームへ
              </button>
            )}{' '}
          </div>
        )}
      </div>
    )
  }
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
        kind: null
      },
      message: ''
    }
  }

  render () {
    const S = this.SCENE
    let content = null

    switch (this.state.scene.kind) {
      case S.WAIT_MUSIC:
        content = this.props.master ? (
          <WaitMusic
            master={true}
            onSendMusic={this.handleSendMusic}
            onFailToLoad={this.handleFailToLoadMusicToSend}
          />
        ) : (
          <WaitMusic master={false} />
        )
        break

      case S.PLAY_AND_ANSWER:
        content = (
          <PlayAndAnswer
            music={this.state.scene.music}
            onAnswer={this.handleInputAnswer}
            onFailToLoad={this.handleFailToLoadMusicToPlay}
          />
        )
        break

      case S.SELECT_CORRECT_ANSWER:
        content = (
          <SelectCorrectAnswer
            onCheckOk={key => this.handleCheckAnswer(key, true)}
            onCheckNg={key => this.handleCheckAnswer(key, false)}
            onSendResult={this.handleSendAnswerResult}
            onReset={this.handleResetResult}
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

    return (
      <div className='SceneView'>
        <p>{this.state.message}</p>
        {content}
      </div>
    )
  }

  _changeScene (kind, data = {}) {
    this.setState({ scene: { kind, ...data }, message: '' })
  }

  _emitAndChangeScene (eventName, arg, sceneKind, sceneData = {}) {
    this.socket.emit(eventName, arg, () => {
      this._changeScene(sceneKind, sceneData)
    })
  }

  _checkScene (kind) {
    return this.state.scene.kind === kind
  }

  componentDidUpdate (prevProps) {
    if (this.props.didAuth) {
      // change scene to WAIT_MUSIC or WAIT_RESET after authentication
      if (
        !this.props.master &&
        this.props.waitForReset &&
        !this._checkScene(this.SCENE.WAIT_RESET)
      ) {
        this._changeScene(this.SCENE.WAIT_RESET)
      } else if (!this._checkScene(this.SCENE.WAIT_MUSIC)) {
        this._changeScene(this.SCENE.WAIT_MUSIC)
        const message =
          'Sorry! The connection to the server was lost, so the game has been reset.'
        this.setState({ message })
      }

      this.props.onProcessForAuth()
    }
  }

  componentDidMount () {
    this._changeScene(this.SCENE.WAIT_MUSIC)

    this.socket.on('error', this.onError)
    this.socket.on('quiz-music', this.onQuizMusic)
    this.socket.on('quiz-answer', this.onQuizAnswer)
    this.socket.on('quiz-result', this.onQuizResult)
    this.socket.on('quiz-reset', this.onQuizReset)
  }

  componentWillUnmount () {
    this.socket.off('error', this.onError)
    this.socket.off('quiz-music', this.onQuizMusic)
    this.socket.off('quiz-answer', this.onQuizAnswer)
    this.socket.off('quiz-result', this.onQuizResult)
    this.socket.off('quiz-reset', this.onQuizReset)
  }

  // Handler for scenes' events
  handleFailToLoadMusicToSend = () => {
    this.setState({
      message:
        "Can't load the music file to be sent. The file may be too big or not exist?"
    })
  }

  handleFailToLoadMusicToPlay = () => {
    this._changeScene(this.SCENE.WAIT_RESET)
    this.setState({
      message:
        "Sorry! Can't load the sent music file. Something may be wrong with the server or the game master."
    })
  }

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
    this._emitAndChangeScene(
      'quiz-reset',
      { message: 'The game master reset the game.' },
      this.SCENE.WAIT_MUSIC
    )
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
  onError = err => {
    this.setState({
      message: `Unexpected error occurred. Contact anqou. (${JSON.stringify(
        err
      )})`
    })
  }

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
    if (!this._checkScene(this.SCENE.SHOW_RESULT)) return
    this._changeScene(this.SCENE.SHOW_RESULT, { answers: msg })
  }

  onQuizReset = msg => {
    this._changeScene(this.SCENE.WAIT_MUSIC)
    if (msg.hasOwnProperty('message')) this.setState({ message: msg.message })
  }
}

class QuizRoom extends Component {
  constructor (props) {
    super(props)
    this.state = {
      socket: newSocket(),
      shouldWaitForReset: false,
      didAuth: false,
      established: null // connecting
    }
    this.roomid = props.roomid

    this.master = props.master
    this.uid = props.uid
    this.password = props.password

    this.socket = this.state.socket
    this.socket.on('auth', (x, done) => {
      done(this.uid, this.password, this.roomid)
    })
    this.socket.on('auth-result', ({ status, shouldWaitForReset }) => {
      this.setState({
        established: status === 'ok',
        shouldWaitForReset,
        didAuth: true
      })
    })
    this.socket.on('disconnect', () => {
      this.setState({ established: null })
    })
  }

  render () {
    if (this.state.established === false) {
      return <Route component={RoomNotFound} />
    }

    return (
      <SocketContext.Provider
        value={{
          established: this.state.established
        }}
      >
        <div className='QuizRoom'>
          <ConnectionStatus />
          <SceneView
            master={this.master}
            socket={this.socket}
            roomid={this.roomid}
            didAuth={this.state.didAuth}
            waitForReset={this.state.shouldWaitForReset}
            onProcessForAuth={this.handleProcessForAuth}
          />
          <ChatWindow socket={this.socket} />
        </div>
      </SocketContext.Provider>
    )
  }

  handleProcessForAuth = () => {
    this.setState({ didAuth: false, shouldWaitForReset: false })
  }
}

class ConnectionStatus extends Component {
  static contextType = SocketContext
  render () {
    return (
      <div className='ConnectionStatus'>
        {this.context.established === null && (
          <p>Connecting to the server. Please hang tight...</p>
        )}
      </div>
    )
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

const RoomNotFound = ({ location }) => (
  <div>
    <h2>お探しの部屋は見つかりませんでした</h2>
    <p>
      この部屋は削除されたか、もともと存在しませんでした。
      中に居る人が全員居なくなると部屋は自動的に削除されます。許して。
    </p>
    <p>
      <Link to='/create-room'>
        ここから部屋を作って新しいゲームを始めて下しあ。
      </Link>
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

    if (!isPrintable(this.inputName.current.value)) return

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
        return <Route component={RoomNotFound} />
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
