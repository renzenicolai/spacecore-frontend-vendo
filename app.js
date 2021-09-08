"use strict";

// System libraries
const fs               = require('fs');
const path             = require('path');

// NPM libraries
const electron         = require('electron');
const yargs            = require('yargs');
const chalk            = require('chalk');

// Project specific libraries
const Configuration    = require('./lib/configuration.js');
const WebSocketClient  = require("./lib/wsclient.js");
const RpcClient        = require("./lib/rpc.js");
const Hardware         = require("./lib/hardware.js");

// Argument parser
const argv = yargs
	.option('config', {
		alias: 'c',
		description: 'Configuration file path',
		type: 'string',
	})
	.help()
	.alias('help', 'h')
	.argv;

var configFile = "configuration.json";
if (argv.config) configFile = argv.config;

// Configuration

var configuration = new Configuration(configFile);

// Error handlers

process.on('unhandledRejection', (err) => {
	console.log(chalk.bgRed.white.bold(" ERROR ")+" Unhandled rejection:", err);
	process.exit(1);
});

process.on('uncaughtException', (err) => {
	console.log(chalk.bgRed.white.bold(" ERROR ")+" Uncaught exception:", err);
	process.exit(1);
});

process.on('SIGINT', () => {
	console.log(chalk.bgRed.white.bold(" ERROR ")+" Application interrupted");
	process.exit(0);
});

process.on('exit', (code) => {
	//Nothing.
});

// Electron UI window

var window = null;

var debug = false;

function createWindow () {
	window = new electron.BrowserWindow({
		width: 1024,
		height: 768,
		icon: path.join(__dirname, 'assets/icon64.png'),
		webPreferences: {
		nodeIntegration: true
		}
	});

	if (!debug) window.removeMenu();
	window.loadFile('assets/index.html');
	if (!debug) window.setFullScreen(true);
}

electron.app.allowRendererProcessReuse = true;
electron.app.whenReady().then(startElectron);

// Global app variables
var appState = "boot";
var appMotors = configuration.get("hardware", "motors");
var appProducts = null;

let appPrefix = configuration.get("location","prefix");
appPrefix = appPrefix ? appPrefix+"-" : "";

// Websocket client & RPC

var wsClient = new WebSocketClient({
	server: configuration.get("server")
});

var rpcClient = new RpcClient({
	ws: wsClient
});

var connected = false;

function onProductList(result, error) {
	if (error) {
		console.log("Unable to list products",error);
		wsClient.disconnect();
		return;
	}
	
	let amount = 0;
	
	
	if (result.length !== appMotors) {
		window.webContents.send("message", "Dispenser error\n"+result.length+" found, expected "+appMotors);
		appState = "error";
		wsClient.disconnect();
		return;
	}
	
	appProducts = [];
	
	for (let i = 1; i < appMotors+1; i++) {
		let name = appPrefix+i;
		let product = null;
		for (let j = 0; j < result.length; j++) {
			if (result[j].name === name) {
				if (result[j].products.length === 1) {
					product = result[j].products[0];
				} else if (result[j].products.length > 1) {
					console.log("Error: location "+name+" cointains multiple products, ignoring location.");
				}
				break;
			}
		}
		appProducts.push(product);
	}
	
	// Signal user that we are ready
	appState = "idle";
	setTokenLed(true, false);
	window.webContents.send("message", "Welcome!\nSELECT PRODUCT");
}

function onAuthenticated() {
	window.webContents.send("message", "Please wait...");
	appState = "productquery";
	rpcClient.request(onProductList, "product/location/list", {"name": {"LIKE":appPrefix+"%"}});
}

function onSessionCreated() {
	window.webContents.send("message", "Authenticating...");
	appState = "authenticating";
	rpcClient.authenticate(onAuthenticated, configuration.get("username"), configuration.get("password"));
}


var wsConnectTimer = 0;
var wsConnectTimeout = null;
function wsConnect(force=false) {
	if (!wsClient.connected()) {
		if (appState === "idle" || force || appState === "connecting" || wsConnectTimer > 50) {
			wsConnectTimer = 0;
			appState = "connecting";
			window.webContents.send("message", "Connecting to server...");
			console.log(chalk.bgMagenta.white.bold(" WS ")+" Connecting to server...");
			wsClient.connect();
		} else {
			window.webContents.send("message", "Internal error\nReset in "+(50-wsConnectTimer));
			wsConnectTimer+=1;
			console.log(chalk.bgMagenta.white.bold(" WS ")+" Waiting for idle ("+wsConnectTimer+")...", appState);
			clearTimeout(wsConnectTimeout);
			wsConnectTimeout = setTimeout(wsConnect, 100);
		}
	}
}

function onWsOpen() {
	wsConnectTimer = 0;
	connected = true;
	console.log(chalk.bgMagenta.white.bold(" WS ")+" Connected to server");
	rpcClient.createSession(onSessionCreated);
}

function onWsClose() {
	if (connected) {
		console.log(chalk.bgMagenta.white.bold(" WS ")+" Connection closed");
		connected = false;
	} else {
		console.log(chalk.bgMagenta.white.bold(" WS ")+" Connection closed, not connected?!");
	}
	clearTimeout(wsConnectTimeout);
	wsConnectTimeout = setTimeout(wsConnect, 2000);
}

function onWsError(error) {
	console.log(chalk.bgMagenta.white.bold(" WS ")+" Connection failed", error);
	clearTimeout(wsConnectTimeout);
	wsConnectTimeout = setTimeout(wsConnect, 2000);
}

wsClient.on("open", onWsOpen);
wsClient.on("close", onWsClose);
wsClient.on("error", onWsError);

function startElectron() {
	createWindow();
	setTimeout(startHardware, 500);
	setTimeout(errorCrasher, 2000);
}

function errorCrasher() {
	if (appState==="error") {
		process.exit(1);
	}
	setTimeout(errorCrasher, 2000);
}

var hardware = new Hardware();

function startHardware() {
	window.webContents.send("message", "Connecting to hardware...");
	hardware.on("initCompleted", startApp);
	hardware.start().then(() => {
		window.webContents.send("message", "Waiting for hardware...");
	});
}

function onHardwareClose(path) {
	appState = "error";
	window.webContents.send("message", "ERROR\nHW CLOSED "+path);
}

function onHardwareError(path) {
	appState = "error";
	window.webContents.send("message", "ERROR\nHW FAIL "+path);
}

function startApp() {
	window.webContents.send("message", "Preparing...");
	
	if (!debug) {
		let expectedHardware = configuration.get("hardware", "devices");
		for (let i in expectedHardware) {
			let ids = expectedHardware[i];
			let devices = hardware.findDevicesOfType(i);
			for (let j = 0; j < ids.length; j++) {
				let found = false;
				for (let k = 0; k < devices.length; k++) {
					let device = devices[k];
					if (device.hwid === ids[j]) {
						found = true;
						break;
					}
				}
				if (!found) {
					window.webContents.send("message", "Device #"+ids[j]+"\n"+i+" error!");
					appState = "error";
					return;
				}
			}
		}
	}
	
	// Register handlers for hardware events
	hardware.on("button", onButton);
	hardware.on("token", onToken);
	hardware.on("close", onHardwareClose);
	hardware.on("error", onHardwareError);
	
	// Connect to Spacecore API
	wsConnect(true);
}

var tokenTimeout = null;
var currentSlot = null;

function onTransactionForDispensing(result, error) {
	if (error) {
		appState = "error";
		window.webContents.send("message", "ERROR\nTRX FAILED");
		console.log("Transaction failed", error);
		return;
	}
	
	console.log("Transaction", result);
	
	dispense(currentSlot);
}

function onPersonForTokenForDispensing(result, error) {
	if (error) {
		appState = "error";
		window.webContents.send("message", "ERROR\nPERSON LOOKUP");
		console.log("Person lookup failed", error);
		return;
	}
	
	if (result === null) {
		window.webContents.send("message", "KEY NOT ASSIGNED");
		setTimeout(onAuthenticated, 2000);
		return;
	}
	
	//console.log("Person", result);
	
	let transaction = {person_id: result.id, products: [{id: appProducts[currentSlot].id, amount: 1}]};
	
	window.webContents.send("message", "Executing transaction...");
	rpcClient.request(onTransactionForDispensing, 'invoice/create', transaction);
}

function onPersonForTokenForStatus(result, error) {
	if (error) {
		appState = "error";
		window.webContents.send("message", "ERROR\nPERSON LOOKUP");
		console.log("Person lookup failed", error);
		return;
	}
	
	if (result === null) {
		window.webContents.send("message", "KEY NOT ASSIGNED");
		setTimeout(onAuthenticated, 2000);
		return;
	}
	
	window.webContents.send("message", result.first_name+" "+result.last_name+"\nYour balance is\nEUR "+(result.balance/100).toFixed(2));
	setTimeout(onAuthenticated, 3000);
}

function onToken(device, token) {
	setTokenLed(false, false);
	if (appState === "product") {
		clearTimeout(tokenTimeout);
		window.webContents.send("message", "Processing...");
		console.log("Token", token);
		rpcClient.request(onPersonForTokenForDispensing, "person/findByTokenForVending", token);
	} else if (appState === "idle") {
		appState = "person";
		rpcClient.request(onPersonForTokenForStatus, "person/findByTokenForVending", token);
	} else {
		console.log("Ignored token, not in product state.", appState);
	}
}

function onDispenseStateChanges(device, state) {
	if (state === "busy") {
		window.webContents.send("message", "Dispensing product...");
	} else if (state === "ready") {
		console.log("Dispensing done, querying product list...");
		device.removeListener("state", onDispenseStateChanges);
		onAuthenticated();
	} else {
		console.log("Dispenser state changed to unknown state", state);
	}
}

function checkEmpty(slot) {
	let drawerDevices = hardware.findDevicesOfType("drawer");
	if (drawerDevices.length===1) {
		return drawerDevices[0].isEmpty(slot);
	} else {
		return true;
	}
}

function dispense(slot) {
	clearTimeout(tokenTimeout);
	setTokenLed(false, false);
	if (appState === "product") {
		let drawerDevices = hardware.findDevicesOfType("drawer");
		if (drawerDevices.length===1) {
			drawerDevices[0].on("state", onDispenseStateChanges);
			if (drawerDevices[0].dispense(slot)) {
				appState = "dispensing";
				window.webContents.send("message", "Please wait...");
				console.log("Dispensing...");
			} else {
				console.log("Error dispense failed");
				window.webContents.send("message", "ERROR\nDISPENSE 1");
				appState = "error";
			}
		} else {
			console.log("Error amount of drawers not 1", drawerDevices.length, drawerDevices);
			window.webContents.send("message", "ERROR\nDISPENSE 2");
			appState = "error";
		}
	} else {
		console.log("Dispense called in wrong state", appState);
		window.webContents.send("message", "ERROR\nDISPENSE 3");
		appState = "error";
	}
}

function onTokenTimeout() {
	setTokenLed(false, false);
	onAuthenticated();
}

function setTokenLed(g,r) {
	let devices = hardware.findDevicesOfType('coin');
	for (let i = 0; i < devices.length; i++) {
		let device = devices[i];
		device.setLed("green", g);
		device.setLed("red", r);
	}
}

function onButton(device, button, value) {
	console.log("onButton", button, value);
	if (value) {
		if (appState === "idle") {
			console.log("currentSlot set to ", button, typeof button);
			currentSlot = button;
			clearTimeout(tokenTimeout);
			tokenTimeout = setTimeout(onTokenTimeout, 3000);
			if (checkEmpty(button)) {
				appState = "noProduct";
				window.webContents.send("message", "OUT OF STOCK");
			} else if (appProducts[button] !== null) {
				appState = "product";
				setTokenLed(false, true);
				let price = "";
				for (let i = 0; i < appProducts[button].prices.length; i++) {
					if (price !== "") {
						price += " / ";
					}
					price += "EUR "+(appProducts[button].prices[i].amount/100.0).toFixed(2);
				}
				window.webContents.send("message", appProducts[button].name+"\n"+price);
			} else {
				appState = "noProduct";
				window.webContents.send("message", "NOT FOR SALE");
			}
		} else {
			console.log("Error not idle, ignored button press", button, appState);
		}
	}
}
