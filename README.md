# node-sqlite3-trans
Proper transaction support for [node-sqlite3](https://github.com/mapbox/node-sqlite3).

## What?
Wraps [node-sqlite3](https://github.com/mapbox/node-sqlite3) database instances to provide proper transaction support — specifically when utilizing async operations. This module is a more modern port of the no longer maintained [sqlite3-transactions](https://github.com/Strix-CZ/sqlite3-transactions).

## Motivation

Considering the following:
```
db.serialize( () => {
 db.exec('BEGIN;');
 
 // ...
 
 fetchAndInsert(db, () => {
   db.exec('COMMIT;');
 });
});
```

We just created ourselves a bug! Other database operations in the code may try to do I/O with our DB while in the transaction including an attempt to create another transaction resulting in `SQLITE_ERROR: cannot start a transaction within a transaction` :poop:.

## Install
```
yarn install node-sqlite3
yarn install sqlite3-trans
```

## Example Usage
```
const sqlite3       = require('sqlite3');
const sqlite3Trans  = require('sqlite3-trans');

const db = sqlite3Trans.wrap(new sqlite3.Database('lmftfy.db'));
```

# License
[LICENSE](LICENSE)