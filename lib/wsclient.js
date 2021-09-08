"use strict";

const EventEmitter = require('events');
const WebSocket    = require('ws');

class WebSocketClient extends EventEmitter {
	constructor(opts={}) {
		super();
		this._opts = Object.assign({
			server: "ws://127.0.0.1:8000"
		}, opts);
		
		this._connection = null;
		this._watchdogTimer = null;
	}
	
	_onOpen() {
		this.emit("open");
		this._isAlive = true;
		this._onPong(); // Start watchdog timer
	}
	
	_onClose() {
		this.emit("close");
		clearTimeout(this._watchdogTimer);
		this._isAlive = false;
		this._connection = null;
	}
	
	_onMessage(data) {
		this.emit("message", data);
	}
	
	_onPong() {
		clearTimeout(this._watchdogTimer);
		this._isAlive = true;
		this._watchdogTimer = setTimeout(this._sendPing.bind(this), 2000);
	}
	
	_sendPing() {
		this._connection.ping();
		this._watchdogTimer = setTimeout(this._watchdog.bind(this), 2000);
	}
	
	_watchdog() {
		// Executed when the watchdog gets triggered
		this._isAlive = false;
		this._connection.terminate();
		this._connection = null;
 		this._onClose(); // Do we need this or does the function now get executed twice?
	}
	
	_onError(error) {
		clearTimeout(this._watchdogTimer);
		this._isAlive = false;
		this._connection.terminate();
		this._connection = null;
		this.emit("error", error);
	}
	
	connected() {
		return this._connection !== null;
	}
	
	connect() {
		if (this._connection !== null) {
			this.disconnect();
			//return false;
		}
		
		this._connection = new WebSocket(this._opts.server, {
			perMessageDeflate: false
		});
		
		this._connection.on('error',   this._onError.bind(this));
		this._connection.on('open',    this._onOpen.bind(this));
		this._connection.on('pong',    this._onPong.bind(this));
		this._connection.on('close',   this._onClose.bind(this));
		this._connection.on('message', this._onMessage.bind(this));
		
		return true;
	}
	
	disconnect() {
		if (this._connection === null) {
			return false;
		}
		this._isAlive = false;
		this._connection.close();
		this._connection = null;
		return true;
	}
	
	send(data) {
		if (this._connection === null) {
			return null;
		}
		return this._connection.send(data);
	}
}

module.exports = WebSocketClient;
