"use strict";

const EventEmitter = require('events');
const chalk        = require('chalk');

class RpcClient extends EventEmitter {
	constructor(opts={}) {
		super();
		this._opts = Object.assign({
			ws: null
		}, opts);
		
		this.token = null;
		this._callbacks = {};
		this._opts.ws.on("message", this._onMessage.bind(this));
		this._internalCallbacks = {};
		
		setInterval(this._sendPing.bind(this), 1000);
	}
	
	_sendPing() {
		this.request(null, "ping");
	}
	
	request(callback, method, parameters=null) {
		let id = ((new Date()).getTime()*1024)+Math.floor(Math.random()*1024);
		let request = {
			jsonrpc: "2.0",
			id: id,
			method: method,
			params: parameters
		};
		if (this.token) {
			request.token = this.token;
		}
		if (callback) {
			this._callbacks[id] = callback;
		}
		if (method !== "ping") {
			console.log(chalk.bgBlue.white.bold(" RPC ")+" "+method+"...");
		}
		this._opts.ws.send(JSON.stringify(request));
	}
	
	_onMessage(data) {
		try {
			let response = JSON.parse(data);
			if (typeof response.id === "number") {
				if (typeof this._callbacks[response.id] === "function") {
					this._callbacks[response.id](response.result, response.error);
					delete this._callbacks[response.id];
				} else if (response.result !== "pong") {
					console.log(chalk.bgRed.white.bold(" RPC ")+" "+"No callback found for response", response, this._callbacks);
				}
			} else {
				console.log(chalk.bgRed.white.bold(" RPC ")+" "+"No ID in response", response);
			}
		} catch (error) {
			console.log(chalk.bgRed.white.bold(" RPC ")+" "+"Error in api callback.", error);
		}
	}
	
	_parseSessionResponse(result, error) {
		if (error) {
			console.log(chalk.bgRed.white.bold(" RPC ")+" "+"Unable to create a session.", error);
			this._opts.ws.disconnect();
			return;
		}
		
		this.token = result;
		
		console.log(chalk.bgBlue.white.bold(" RPC ")+" Session id = "+this.token);
		
		if (typeof this._internalCallbacks.createSession === "function") {
			this._internalCallbacks.createSession();
		}
		delete this._internalCallbacks.createSession;
	}
	
	createSession(callback=null) {
		this._internalCallbacks.createSession = callback;
		this.request(this._parseSessionResponse.bind(this), "session/create");
	}
	
	_parseAuthenticationResponse(result, error) {
		if (error) {
			console.log(chalk.bgRed.white.bold(" RPC ")+" "+"Unable to authenticate.", error);
			this._opts.ws.disconnect();
			return;
		}
		
		console.log(chalk.bgBlue.white.bold(" RPC ")+" Authenticated.");
		
		if (typeof this._internalCallbacks.authenticate === "function") {
			this._internalCallbacks.authenticate();
		}
		delete this._internalCallbacks.authenticate;
	}
	
	authenticate(callback=null, username="", password=null) {
		this._internalCallbacks.authenticate = callback;
		let args = {
			user_name: username
		};
		if (typeof password === "string") {
			args.password = password;
		}
		this.request(this._parseAuthenticationResponse.bind(this), "user/authenticate", args);
	}
}

module.exports = RpcClient;
