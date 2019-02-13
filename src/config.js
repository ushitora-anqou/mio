const normal = {
  server_uri: 'localhost:4000'
}

const test = {
  server_uri: 'localhost:4400'
}

const config = process.env.MIO_TEST ? test : normal

export { config }
