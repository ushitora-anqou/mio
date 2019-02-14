const dev = {
  server_uri: 'localhost:4000'
}

const test = {
  server_uri: 'localhost:4400'
}

const prod = {
  server_uri: process.env.MIO_SERVER_URI
}

const config = process.env.MIO_TEST ? test : process.env.MIO_PROD ? prod : dev

export { config }
