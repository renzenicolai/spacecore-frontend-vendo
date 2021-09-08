"use strict";

const fs           = require('fs');
const path         = require('path');
const EventEmitter = require('events');
const SerialPort   = require('serialport');
const Readline     = SerialPort.parsers.Readline;

class Device extends EventEmitter {
	constructor(parent, path) {
		super();
		this.parent = parent;
		this.path = path;
		this.port = new SerialPort(path, {baudRate: 115200});
		this.port.on('open', this._onOpen.bind(this));
		this.port.on('error', this._onError.bind(this));
		this.port.on('close', this._onClose.bind(this));
		this.parser = new Readline();
		this.parser.on('data', this._onData.bind(this));
		this.port.pipe(this.parser);
		
		this.ready = false;
		
		this.hwid    = null;      // Hardware identifier
		this.type    = null;      // Hardware type
		this.motors  = 0;         // Amount of motors / slots available on this drawer
		this.buttons = [];        // Button status
		this.empty   = [];        // Slot empty status
		this.state   = "unknown"; // 
	}
	
	_splitBitmask(octet) {
		var bits = [];
		for (var i = 0; i < 8; i++) {
			var bit = octet & (1 << i) ? true : false;
			bits.push(bit);
		}
		return bits;
	}
	
	_combineBitmask(bits) {
		let octet = 0;
		for (let i = 0; i < bits.length; i++) {
			if (bits[i]) octet += (1<<i);
		}
		return octet;
	}
	
	_onOpen() {
		console.log(this.path+" onOpen()");
		setTimeout(this._initDevice.bind(this), 5000);
	}
	
	_onError(error) {
		console.log(this.path+" onError()", error);
		this.emit("close", this.path);
	}
	
	_onClose() {
		console.log(this.path+" onClose()");
		this.emit("close", this.path);
	}
	
	_onData(data) {
		data = data.replace(/[^\x20-\x7E]/g, "");
		
		if (data.startsWith("#")) {
			// Received debug message
			console.log(this.path+" debug: "+data);
			return;
		}
		
		var parts = data.split("=");
		if (parts.length != 2) {
			console.log("Received garbage data on "+this.path+":",data);
		}
		
		if (parts[0]==="type") {
			// Device type
			this.type = parts[1];
		} else if (parts[0]==="id") {
			// Device identifier
			this.hwid = Number(parts[1]);
		} else if (parts[0]==="motors") {
			// drawer: amount of motors / slots available on this device
			this.motors = Number(parts[1]);
		} else if (parts[0]==="boot") {
			// Device boot message
			/* ignore */
		} else if (this.hwid === null || this.type === null || !this.ready) {
			// Not initialized, ignore all other data
			return;
		} else if (parts[0]==="state") {
			// Device state
			if (this.state != parts[1]) {
				this.state = parts[1];
				console.log(this.path, "state changed", parts[1]);
				this.emit("state", this, parts[1]);
			}
		} else if (parts[0]==="ibutton") {
			// ibutton/coin: identifier of presented iButton
			this.emit("token", this, parts[1]);
		} else if (parts[0]==="empty") {
			// drawer: empty status bitmask
			if (this.motors < 1) {
				console.log(this.path,"Ignoring empty amount as motors is not set.");
				return; // Ignore until we know the amount of slots.
			}
			let previousEmpty = this.empty;
			this.empty = this._splitBitmask(Number(parts[1]));
			for (let i = 0; i < this.motors; i++) {
				let previousValue = (previousEmpty.length > i) ? previousEmpty[i] : (!this.empty[i]);
				if (this.empty[i] != previousValue) {
					this.emit("empty", this, i, this.empty[i]); // Emit empty event
				}
			}
		} else if (parts[0]==="buttons") {
			// frontpanel: button status bitmask
			let previousButtons = this.buttons;
			this.buttons = this._splitBitmask(Number(parts[1]));
			for (let i = 0; i < this.buttons.length; i++) {
				let previousValue = (previousButtons.length > i) ? previousButtons[i] : false;
				if (this.buttons[i] != previousValue) {
					this.emit("button", this, i, this.buttons[i]); // Emit button event
				}
			}
		} else if (parts[0]==="coin") {
			// coin: money accepted
			this.emit("coin", this, Number(parts[1]));
		} else if (parts[0].startsWith("temp")) {
			// fridge: temperature reading
			/* ignore */
		} else {
			console.log("Unkown parameter",parts[0],"=",parts[1]);
		}
	}
	
	_initDevice() {
		if ((!this.hwid) || (!this.type)) {
			console.log(this.path+" does not appear to be a compatible device, disconnecting.");
			this.parent._remove(this.path);
		} else {
			console.log(this.path+" is a device of type "+this.type+" with id "+this.hwid);
			this.parent._register(this, this.path, this.type, this.hwid);
			setTimeout(this._sendInitData.bind(this), 1000);
		}
	}
	
	_sendInitData() {
		if (this.type === "drawer") {
			if (this.motors < 1) {
				console.log(this.path,"Asking amount of motors");
				this.port.write("m"); // Ask amount of motors
				setTimeout(this._sendInitData.bind(this), 1000);
			}
		}
	}
	
	setLed(id, value) {
		if (this.type === "coin") {
			if (id === "red") {
				if (value) {
					this.port.write("R");
				} else {
					this.port.write("r");
				}
			} else if (id === "green") {
				if (value) {
					this.port.write("G");
				} else {
					this.port.write("g");
				}
			} else if (id === "return") {
				if (value) {
					this.port.write("L");
				} else {
					this.port.write("l");
				}
			} else {
				console.log(this.type, "invalid led type.");
			}
		} else if (this.type === "frontpanel") {
			console.log("LED",id,value);
			if (value) {
				this.port.write("L"+Number(id)+"\n");
			} else {
				this.port.write("l"+Number(id)+"\n");
			}
		} else {
			console.log(this.type, "can't set led.");
		}
	}
	
	setEnableMoneyIntake(value) {
		if (this.type === "coin") {
			if (value) {
				this.port.write("e");
			} else {
				this.port.write("d");
			}
		} else {
			console.log(this.type, "can't enable money intake.");
		}
	}
	
	setReady(value) {
		this.ready = value;
	}
	
	dispense(motor) {
		motor = Number(motor);
		if (this.type === "drawer") {
			if ((motor >= 0) && (motor < this.motors)) {
				this.port.write("d"+motor+"\n");
				return true;
			} else {
				console.log(this.type, "motor out of range",motor,this.motors);
			}
		} else {
			console.log(this.type, "can't dispense a product.");
		}
		return false;
	}
	
	isEmpty(motor) {
		if ((motor < 0)||(motor >= this.motors)) {
			return true;
		}
		return this.empty[motor];
	}
}

class Hardware extends EventEmitter {
	constructor(opts={}) {
		super();
		this._opts = Object.assign({
			// Empty
		}, opts);
		
		this._uninitializedDevices = {};
		this._devices = {};
		
		this._test_enable_coin = false;
	}
	
	findDevicesOfType(type) {
		let list = [];
		for (let i in this._devices) {
			if (this._devices[i].type === type) {
				list.push(this._devices[i].device);
			}
		}
		return list;
	}
	
	_listPorts() {
		var devices = fs.readdirSync("/dev");
		devices = devices.filter((device) => device.startsWith("ttyUSB") || device.startsWith("ttyACM"));
		return devices;
	}
	
	_onToken(device, token) {
		this.emit("token", device, token);
	}
	
	_onEmpty(device, slot, state) {
		var fpDevices = this.findDevicesOfType("frontpanel");
			for (let i = 0; i<fpDevices.length; i++) {
			fpDevices[i].setLed(slot, state);
		}
	}
	
	_onCoin(device, amount) {
		console.log("COIN", device.hwid, amount);
	}
		
	_onButton(device, button, state) {
		console.log("button passthrough", button, state);
		this.emit("button", device, button, state);
		//console.log("BUTTON", device.hwid, button, state);
		//device.setLed(button, state);
		/*if (state && button === 0) {
			//Test :-)
			this._test_enable_coin = !this._test_enable_coin;
			var devices = this.findDevicesOfType("coin");
			for (let i = 0; i<devices.length; i++) {
				devices[i].setLed("return", this._test_enable_coin);
				devices[i].setEnableMoneyIntake(this._test_enable_coin);
			}
		}*/
	}
	
	async start() {
		var portNames = this._listPorts();
		
		for (let i = 0; i < portNames.length; i++) {
			let path = "/dev/"+portNames[i];
			let device = new Device(this, path);
			device.on("token",  this._onToken.bind(this));
			device.on("empty",  this._onEmpty.bind(this));
			device.on("button", this._onButton.bind(this));
			device.on("coin",   this._onCoin.bind(this));
			//device.on("state",  this._onState.bind(this));
			this._uninitializedDevices[path] = device;
		}
		
		setTimeout(this._onStartDelay.bind(this), 10000);
	}
	
	_onStartDelay() {
		console.log("========= HW START DELAY =========");
		for (let i in this._devices) {
			this._devices[i].device.setReady(true);
		}
		this.emit("initCompleted");
	}
	
	_remove(path) {
		delete this._uninitializedDevices[path];
	}
	
	_register(object, path, type, id) {
		console.log("New device registered: ", path, type, id);
		this._devices[id] = {type: type, id: id, device: object};
	}
}

module.exports = Hardware;
