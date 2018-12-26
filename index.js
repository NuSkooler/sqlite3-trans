/* jslint node: true */
'use strict';

//	deps
const EventEmitter	= require('events').EventEmitter;

const { 
	functionsIn, 
	isFunction,
	bind,
}					= require('lodash');

const NON_PROXIED_METHOD_NAMES = [
	'emit', 'addListener', 'setMaxListeners', 'on', 'once', 'removeListener',
	'removeAllListeners', 'listeners', 'prepare',
];

const LOCKING_METHODS = [
	'exec', 'run', 'get', 'all', 'each', 'map', 'finalize', 'reset'
];

module.exports = class TransDatabase extends EventEmitter {
	constructor(db) {
		super();
		
		this.db			= db;
		this.queue		= [];
		this.lockCount	 = 0;

		this.db.serialize();

		this._exec	= bind(this.db.exec, this.db);

		this._wrapDbObject(this, this, this.db);

		this.db.on('error', () => {
			if(this.currentTransaction) {
				this.currentTransaction.rollback( () => { } );
			}
		});

		//
		//	wrap prepare which is handled without locking logic
		//	directly, but instead with inner methods
		//
		const self = this;
		this.prepare = function() {
			const oldStatement	= self.db.prepare.apply(self.db, arguments);
			const newStatement	= new EventEmitter();
			self._wrapDbObject(self, newStatement, oldStatement);
			return newStatement;
		}
	}

	static wrap(db) {
		return new TransDatabase(db);
	}

	beginTransaction(cb) {
		if(this.currentTransaction) {
			return this.queue.push({
				type	: 'transaction',
				object	: this,
				method	: 'beginTransaction',
				args	: arguments,
			});
		}

		const trans				= this.db;
		let finished			= false;
		this.currentTransaction	= trans;
		const self				= this;

		function finishTransaction(err, callback) {
			finished				= true;
			self.currentTransaction	= null;
			self._flushQueue();
			return callback(err);
		}

		trans.commit = function(callback) {
			if(finished) {
				return callback(new Error('Transaction already finished'));
			}

			self._wait( () => {
				self._exec('COMMIT;', err => {
					return finishTransaction(err, callback);
				});
			});
		}

		trans.rollback = function(callback) {
			if(finished) {
				return callback(new Error('Transaction already finished'));
			}

			self._wait( () => {
				self._exec('ROLLBACK;', err => {
					return finishTransaction(err, callback);
				});
			});
		}
		
		//	OK, now begin
		this._wait(err => {
			if(err) {
				finishTransaction(err, cb);
			}

			self._exec('BEGIN;', err => {
				if(err) {
					return cb(err);
				}

				return cb(null, trans);
			});
		});
	}

	_wait(cb) {
		const self = this;

		function check() {
			if(0 === self.lockCount) {
				return cb();
			} else {
				setImmediate(check);
			}
		}

		return check();
	}

	_flushQueue() {
		while(this.queue.length > 0) {
			const queuedItem = this.queue.shift();

			if('lock' === queuedItem.type) {
				++this.lockCount;
			}

			//	perform queued call
			queuedItem.object[queuedItem.method].apply(queuedItem.object, queuedItem.args);

			if('transaction' === queuedItem.type) {
				break;
			}
		}
	}

	_wrapDbObject(transDb, target, source) {
		functionsIn(source)
			.filter( methodName => this._isProxyMethod(methodName) ).forEach(methodName => {
				target[methodName] = this._wrapDbMethod(transDb, source, methodName);
			}
		);

		this._interceptEmittedEvents(target, source, bind(target.emit, target));
	}

	_isProxyMethod(methodName) {
		return !NON_PROXIED_METHOD_NAMES.includes(methodName);
	}

	static _isLockedMethod(methodName) {
		return LOCKING_METHODS.includes(methodName);
	}

	_wrapDbMethod(transDb, object, methodName) {
		return function() {
			const args = arguments;

			const lockedMethod = TransDatabase._isLockedMethod(methodName);

			if(lockedMethod) {
				
				function missingCallback(err) {
					if(err) {
						transDb.db.emit('error', err);
					}
				}

				//	ensure each rolls back on error to decrement |lockCount|
				if('each' === methodName) {
					if(args.length < 2 || 
						!isFunction(args[args.length - 1]) && !isFunction(args[args.length- 2]))
					{
						args[args.length] = args[args.length + 1] = missingCallback;
						args.length += 2;
					} else if(isFunction(args[args.length- 1]) && !isFunction(args[args.length - 2])) {
						args[args.length] = missingCallback;
						args.length += 1;
					}
				}

				let originalCallback;
				
				const newCallback = function() {
					if(transDb.lockCount < 1) {
						throw new Error('Locks are not balanced!');
					}

					--transDb.lockCount;

					originalCallback.apply(this, arguments);
				}

				if(args.length > 0 && isFunction(args[args.length- 1])) {
					originalCallback = args[args.length - 1];
					args[args.length - 1] = newCallback;
				} else {
					originalCallback 	= missingCallback;
					args[args.length]	= newCallback;
					args.length	+= 1;
				}
			}

			if(!this.currentTransaction) {
				if(lockedMethod) {
					transDb.lockCount++;
				}
				
				object[methodName].apply(object, args);	//	call inner
			} else {
				//	already in transaction; defer
				transDb.queue.push({
					type : lockedMethod ? 'lock' : 'simple',
					object,
					method : methodName,
					args
				});
			}

		};
	}

	_interceptEmittedEvents(target, emitter, handler) {
		const oldEmit = emitter.emit;
		
		emitter.emit = function() {
			handler.apply(target, arguments);
			oldEmit.apply(emitter, arguments);
		};
	}
};
