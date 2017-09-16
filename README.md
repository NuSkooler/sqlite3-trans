# node-sqlite3-trans
Proper transaction support for [node-sqlite3](https://github.com/mapbox/node-sqlite3).

## What?
Wraps [node-sqlite3](https://github.com/mapbox/node-sqlite3) database instances to provide proper transaction support — specifically when utilizing async operations.

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

# License
[LICENSE](LICENSE)