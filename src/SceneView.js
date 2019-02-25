import React, { Component } from 'react'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import update from 'immutability-helper'
import './SceneView.css'
import { isEmpty, isPrintable, QuizRoomContext } from './helper'

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
  const compressor = offlineCtx.createDynamicsCompressor()
  const source = offlineCtx.createBufferSource()
  source.buffer = decodedBuf
  source.connect(compressor)
  compressor.connect(offlineCtx.destination)
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

class SelectMusic extends Component {
  static contextType = QuizRoomContext

  constructor (props) {
    super(props)

    this.state = {
      sending: false,
      randomPlay: false,
      randomSelect: false,
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
        file = this.props.files[
          Math.floor(Math.random() * this.props.files.length)
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
      this.props.onChangeMusicFileList(
        update(this.props.files, {
          $splice: [[this.props.files.indexOf(this.state.selectedFile), 1]]
        })
      )

      this.props.onSendMusic({
        music: musicBuf,
        title: this.state.selectedFile.name
      })
      this.timerID = setTimeout(() => {
        this.setState({ sending: false })
      }, 2000)
    }
  }

  componentDidMount () {
    this.setState({
      randomPlay:
        this.context.sessionStorage.getItem('checkRandomPlay') === 'enabled',
      randomSelect:
        this.context.sessionStorage.getItem('checkRandomSelect') === 'enabled'
    })
  }

  componentWillUnmount () {
    if (this.timerID) clearInterval(this.timerID)
    this.context.sessionStorage.setItem(
      'checkRandomPlay',
      this.state.randomPlay ? 'enabled' : 'disabled'
    )
    this.context.sessionStorage.setItem(
      'checkRandomSelect',
      this.state.randomSelect ? 'enabled' : 'disabled'
    )
  }

  render () {
    return (
      <div className='SelectMusic'>
        <div>
          <h2>問題曲を出題する</h2>
          <form onSubmit={this.handleSubmit}>
            <FileList
              files={this.props.files}
              onChange={files => {
                if (files.indexOf(this.state.selectedFile) === -1)
                  this.setState({ selectedFile: null })
                return this.props.onChangeMusicFileList(files)
              }}
              onSelect={file => this.setState({ selectedFile: file })}
              disableSelect={this.state.randomSelect}
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
                  this.props.files.length === 0 ||
                  this.context.numOfOnlineUsers <= 1
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
              disabled={props.disableSelect}
            />
            <span
              className={props.disableSelect ? 'FileListEntryDisabled' : ''}
            >
              {file.name}
            </span>
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
    return <div className='PlayAndAnswer'>{this.state.scene}</div>
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
        console.log(err)
        if (props.onFailToLoad) props.onFailToLoad()
      })
  }

  componentWillUnmount () {
    if (this.source) {
      this.source.onended = null
      this.source.stop()
    }
  }

  onClickStart = () => {
    if (this.state.music_buf) {
      this.setState({ playing: true })
      if (this.props.onMusicStart)
        this.props.onMusicStart(this.audioCtx.currentTime)

      // play the music
      this.source = this.audioCtx.createBufferSource()
      this.source.buffer = this.state.music_buf
      this.source.connect(this.audioCtx.destination)
      this.source.onended = () => {
        this.setState({ playing: false })
        if (this.props.onMusicStop)
          this.props.onMusicStop(this.audioCtx.currentTime)
      }
      this.source.start(0)
    }
  }

  onClickStop = () => {
    if (this.source) this.source.stop()
  }

  render () {
    const props = {
      disabled: this.state.music_buf ? false : true,
      playing: this.state.playing,
      onClickStart: this.onClickStart,
      onClickStop: this.onClickStop
    }

    if (this.props.render) return this.props.render(props)

    return <MusicPlayingButton {...props} />
  }
}

function MusicPlayingButton (props) {
  return (
    <>
      {props.playing ? (
        <button onClick={props.onClickStop}>
          <FontAwesomeIcon icon={['far', 'stop-circle']} />
        </button>
      ) : (
        <button onClick={props.onClickStart} disabled={props.disabled}>
          <FontAwesomeIcon icon={['far', 'play-circle']} />
        </button>
      )}
    </>
  )
}

class InputAnswer extends Component {
  static contextType = QuizRoomContext

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

  handleThrough = () => {
    this.props.onSubmit(null)
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
        <button
          disabled={this.state.sending || !this.context.established}
          onClick={this.handleThrough}
        >
          スルー
        </button>
      </div>
    )
  }
}

class SelectCorrectAnswer extends Component {
  static contextType = QuizRoomContext

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
        Object.keys(answers).every(
          uid => !answers[uid].answer || answers[uid].hasOwnProperty('judge')
        )
      )
    }

    return (
      <div className='SelectCorrectAnswer'>
        <h2>採点</h2>
        <div className='InputCorrectAnswer'>
          <h3>正答</h3>
          <div>
            <PlayMusic music={this.props.music} />
            <InputCorrectAnswer
              answer={answer}
              onChange={this.handleAnswerChange}
            />
          </div>
        </div>
        <div>
          <h3>解答</h3>
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
              className='SelectCorrectAnswerScoringEnd'
              onClick={this.props.onSendResult}
              disabled={this.state.sending || !this.context.established}
            >
              採点終了
            </button>
          )}
        </div>
      </div>
    )
  }
}

function InputCorrectAnswer (props) {
  return (
    <>
      <input type='text' value={props.answer} onChange={props.onChange} />
    </>
  )
}

function ShowResultEntries (props) {
  const entries = props.entries
  const uids = Object.keys(entries).sort(
    (lhs_uid, rhs_uid) => entries[lhs_uid].time - entries[rhs_uid].time
  )

  return (
    <div className='ShowResultEntries'>
      {uids.map((uid, index) => {
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
            <div className='ShowResultEntriesColumn ShowResultEntriesColumnIndex'>
              {index + 1}
            </div>
            <div className='ShowResultEntriesColumn ShowResultEntriesColumnName'>
              {entry.name}
            </div>
            <div className='ShowResultEntriesColumn ShowResultEntriesColumnTime'>
              {entry.time.toFixed(4)}
            </div>
            <div className='ShowResultEntriesColumn ShowResultEntriesColumnAnswer'>
              {entry.answer ? entry.answer : '（スルー）'}
            </div>
            {props.judging && (
              <div className='ShowResultEntriesColumn'>
                {entry.answer && (
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
                      <FontAwesomeIcon icon={['far', 'circle']} />
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
                      <FontAwesomeIcon icon='times' />
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

class ShowResult extends Component {
  static contextType = QuizRoomContext

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
      message: '',
      listedMusicFiles: []
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
            files={this.state.listedMusicFiles}
            onChangeMusicFileList={files =>
              this.setState({ listedMusicFiles: files })
            }
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
            music={this.state.scene.music}
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

      default:
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
      if (!this.props.master && this.props.waitForReset) {
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
      { music: music.buffer, answers: {}, answer: title }
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
    this.props.onQuizReset(this.state.scene.answer)
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
    if (this._checkScene(this.SCENE.SHOW_RESULT) && this.state.scene.answer)
      this.props.onQuizReset(this.state.scene.answer)

    this._changeScene(this.SCENE.WAIT_MUSIC)
    if (msg.hasOwnProperty('message')) this.setState({ message: msg.message })
  }
}

export default SceneView
