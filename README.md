# Mio - Intro Quiz App

[![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/ushitora-anqou/mio)

## これはなに

サクッとイントロクイズで遊びたい人のためのNodeJS実装。Dockerの上に載っていて、Herokuで使うことを想定しています。
PostgreSQLをSequelize経由で使っています。サーバはExpressで立っていて、サーバとクライアントの接続を
Socket.IO経由で行います。フロントエンドはReactです。

## 忙しい人のためのMioの使い方

上の'Deploy to Heroku'ボタンを押してください。

## ローカルで動かしたい人は

Dockerを通して動かそうとするとPostgreSQLをどこで動かすかという問題に遭遇するので、どうにか解決してください。
私は諦めました。

非Dockerの場合は`yarn install --pure-lockfile`後に
クライアント側の設定 `src/config.js`とサーバー側の設定 `server/config.js`をいじってから、
データベースを `createdb testdb` として作成し、

- `yarn start`
- `node server/index.js`

です。そして `localhost:3000` にアクセス！

## License

MIT.

## どうしてつくったの

友だちがお金くれるって言ったから。

## デザインがひどい

ゆるして

## その他

[イントロクイズWebアプリ Mioをつくった](https://anqou.net/poc/2019/02/21/post-2742/)
