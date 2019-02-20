const dev = {
  server_uri: 'localhost:4000'
}

/*
const test = {
  server_uri: 'localhost:4400'
}
*/

const prod = {
  server_uri: undefined
}

const config = process.env.NODE_ENV === 'production' ? prod : dev

export { config }
