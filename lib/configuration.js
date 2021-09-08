"use strict";

const fs    = require('fs');
const chalk = require('chalk');

class Configuration {
	constructor(filename) {
		if (filename === null) {
			this._data = {};
		} else {
			try {
				this._data = JSON.parse(fs.readFileSync(filename));
			} catch {
				console.log(chalk.white.bold.inverse(" CONFIG ")+" "+chalk.red("Unable to read configuration file"));
				process.exit(1);
			}
		}
	}
	
	get(/* ... */) {
		for (var i = 0; i < arguments.length; i++) {
			if (typeof arguments[i] != "string") {
				console.log(chalk.white.bold.inverse(" CONFIG ")+" "+chalk.yellow("Configuration parameter get called with invalid arguments"));
				console.log(arguments);
				return null;
			}
		}
		var ans = this._data;
		var key = "";
		if (arguments.length > 0) {
			try {
				for (var i = 0; i < arguments.length; i++) {
					ans = ans[arguments[i]];
					key += " "+arguments[i];
				}
			} catch {
				ans = null;
			}
		}
		if (typeof ans === "undefined") {
			ans = null;
		}
		if (ans === null) {
			var args = Array.prototype.slice.call(arguments);
			console.log(chalk.white.bold.inverse(" CONFIG ")+" "+chalk.yellow("Configuration parameter "+args.join('.')+" not set"));
		}
		return ans;
	}
}

module.exports = Configuration;
