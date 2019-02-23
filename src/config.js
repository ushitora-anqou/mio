const dev = {
  server_uri: 'localhost:4000',
  storage: sessionStorage
  //storage: localStorage
}

/*
const test = {
  server_uri: 'localhost:4400'
}
*/

const prod = {
  server_uri: undefined,
  storage: localStorage
}

const config = process.env.NODE_ENV === 'production' ? prod : dev

export { config }
