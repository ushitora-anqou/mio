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

async function trimMusic (encodedBuf, channels, sampleRate, kbps, calcPos) {
  // get PCM wave of the head of the music
  const audioCtx = new AudioContext()
  const decodedBuf = await audioCtx.decodeAudioData(encodedBuf)
  const { offset, seconds } = calcPos(decodedBuf.duration)
  const offlineCtx = new OfflineAudioContext(
    channels,
    sampleRate * seconds,
    sampleRate
  )
  const source = offlineCtx.createBufferSource()
  source.buffer = decodedBuf
  source.connect(offlineCtx.destination)
  source.start(0, offset, seconds)
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

class SelectMusic extends Component {
  static contextType = SocketContext

  constructor (props) {
    super(props)

    this.state = {
      sending: false,
      randomPlay: false,
      randomSelect: false,
      files: [],
      selectedFile: null
    }
  }

  handleSubmit = async e => {
    e.preventDefault()
    this.setState({ sending: true })

    let musicBuf = null
    try {
      let file = this.state.selectedFile
      if (this.state.randomSelect) {
        file = this.state.files[
          Math.floor(Math.random() * this.state.files.length)
        ]
        this.setState({ selectedFile: file })
      }

      if (file.size > 20000000) throw new Error('The file is too big.')
      musicBuf = await trimMusic(
        await readFileAsync(file),
        2,
        44100,
        128,
        duration => {
          const seconds = 15
          if (duration < seconds) return { offset: 0, seconds: duration }
          if (!this.state.randomPlay) return { offset: 0, seconds }
          const offset = Math.random() * (duration - seconds)
          return { offset, seconds }
        }
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
      this.props.onSendMusic({
        music: musicBuf,
        title: this.state.selectedFile.name
      })
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
      <div className='SelectMusic'>
        <div>
          <h2>問題曲を出題する</h2>
          <form onSubmit={this.handleSubmit}>
            <FileList
              files={this.state.files}
              onChange={files => this.setState({ files })}
              onSelect={file => this.setState({ selectedFile: file })}
            />
            <div>
              <label>
                <input
                  type='checkbox'
                  checked={this.state.randomSelect}
                  onChange={e =>
                    this.setState({ randomSelect: e.target.checked })
                  }
                />
                勝手に選曲する
              </label>
            </div>
            <div>
              <label>
                <input
                  type='checkbox'
                  checked={this.state.randomPlay}
                  onChange={e =>
                    this.setState({ randomPlay: e.target.checked })
                  }
                />
                再生位置をランダムにする
              </label>
            </div>
            <div>
              <button
                type='submit'
                disabled={
                  this.state.sending ||
                  !this.context.established ||
                  (!this.state.randomSelect && !this.state.selectedFile) ||
                  this.state.files.length === 0
                }
              >
                出題
              </button>
            </div>
          </form>
        </div>
        <ShareURL />
      </div>
    )
  }
}

function WaitMusic (props) {
  return (
    <div className='WaitMusic'>
      <p>問題曲が届くのを待っています……</p>
      <ShareURL />
    </div>
  )
}

function FileList (props) {
  return (
    <div className='FileList'>
      <p>曲を選んでください。</p>
      <div className='FileListContainer'>
        {props.files.map(file => (
          <label>
            <input
              type='radio'
              name='FileListEntry'
              onChange={() => props.onSelect(file)}
            />
            <span>{file.name}</span>
          </label>
        ))}
      </div>
      <label className='FileListAddButton'>
        ＋曲を追加
        <input
          type='file'
          accept='audio/*'
          multiple='multiple'
          onChange={e => {
            props.onChange(props.files.concat(Array.from(e.target.files)))
            e.target.value = ''
          }}
        />
      </label>
      <label className='FileListAllDeleteButton'>
        全削除
        <input
          type='button'
          onClick={e => {
            props.onChange([])
          }}
        />
      </label>
    </div>
  )
}

function ShareURL (props) {
  const urlRef = React.createRef()
  return (
    <div className='ShareURL'>
      <div>
        <label>クイズの参加者にはこのページのURLを共有して下さい：</label>
        <input type='text' value={window.location.href} ref={urlRef} readOnly />
        <button
          onClick={() => {
            urlRef.current.select()
            document.execCommand('Copy')
          }}
        >
          コピー
        </button>
      </div>
    </div>
  )
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

  handleAnswerChange = e => {
    this.props.onAnswerChange(e.target.value)
  }

  render () {
    const answer = this.props.answer
    const answers = this.props.answers
    const canSendResult = () => {
      return (
        isPrintable(answer) &&
        Object.keys(answers).every(uid => answers[uid].hasOwnProperty('judge'))
      )
    }

    return (
      <div className='SelectCorrectAnswer'>
        <h2>採点</h2>
        <InputCorrectAnswer
          answer={answer}
          onChange={this.handleAnswerChange}
        />
        {isEmpty(answers) ? (
          <p>解答を待っています……</p>
        ) : (
          <ShowResultEntries
            entries={answers}
            onClickOk={this.props.onCheckOk}
            onClickNg={this.props.onCheckNg}
            judging={true}
          />
        )}
        {canSendResult() && (
          <button
            onClick={this.props.onSendResult}
            disabled={this.state.sending || !this.context.established}
          >
            採点終了
          </button>
        )}
      </div>
    )
  }
}

function InputCorrectAnswer (props) {
  return (
    <div className='InputCorrectAnswer'>
      <label>正答：</label>
      <input type='text' value={props.answer} onChange={props.onChange} />
    </div>
  )
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
        {!this.props.answer ? (
          <p>採点が終了するのを待っています……</p>
        ) : (
          <div>
            <p>正答：{this.props.answer}</p>
            <ShowResultEntries entries={this.props.answers} judging={false} />
            {this.props.master && (
              <button
                onClick={this.props.onReset}
                disabled={this.state.sending || !this.context.established}
              >
                次のゲームへ
              </button>
            )}
          </div>
        )}
      </div>
    )
  }
}

function WaitReset (props) {
  return (
    <div className='WaitReset'>
      <p>いま行われているゲームが終わるのを待っています……</p>
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
          <SelectMusic
            onSendMusic={this.handleSendMusic}
            onFailToLoad={this.handleFailToLoadMusicToSend}
          />
        ) : (
          <WaitMusic />
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
            answer={this.state.scene.answer}
            answers={this.state.scene.answers}
            onAnswerChange={this.handleAnswerChange}
          />
        )
        break

      case S.SHOW_RESULT:
        content = this.props.master ? (
          <ShowResult
            answer={this.state.scene.answer}
            answers={this.state.scene.answers}
            master={true}
            onReset={this.handleResetResult}
          />
        ) : (
          <ShowResult
            answer={this.state.scene.answer}
            answers={this.state.scene.answers}
            master={false}
          />
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
          'サーバへの通信が途絶えたため、行われていたゲームがリセットされました。ゆるして'
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

  handleSendMusic = ({ music, title }) => {
    this._emitAndChangeScene(
      'quiz-music',
      { buf: music },
      this.SCENE.SELECT_CORRECT_ANSWER,
      { answers: {}, answer: title }
    )
  }

  handleCheckAnswer = (key, correct) => {
    this.setState((state, props) => ({
      scene: update(state.scene, {
        answers: { [key]: { judge: { $set: correct } } }
      })
    }))
  }

  handleAnswerChange = answer => {
    this.setState((state, props) => ({
      scene: update(state.scene, { answer: { $set: answer } })
    }))
  }

  handleSendAnswerResult = () => {
    const result = {
      answer: this.state.scene.answer,
      answers: this.state.scene.answers
    }
    this._emitAndChangeScene(
      'quiz-result',
      result,
      this.SCENE.SHOW_RESULT,
      result
    )
  }

  handleResetResult = () => {
    this._emitAndChangeScene('quiz-reset', {}, this.SCENE.WAIT_MUSIC)
  }

  handleInputAnswer = (time, answer) => {
    this._emitAndChangeScene(
      'quiz-answer',
      { time, answer },
      this.SCENE.SHOW_RESULT,
      { answers: {}, answer: '' }
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
    if (
      !(
        this._checkScene(this.SCENE.PLAY_AND_ANSWER) ||
        this._checkScene(this.SCENE.SHOW_RESULT)
      )
    )
      return
    this._changeScene(this.SCENE.SHOW_RESULT, {
      answers: msg.answers,
      answer: msg.answer
    })
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
          <p>サーバへの接続が不安定です。しばらくお待ちください……</p>
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
