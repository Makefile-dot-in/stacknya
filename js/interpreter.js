function display(s) {
	document.getElementById("output").innerHTML += s;
}

// A limited stack.
function Stack(array) {
	this.array = array;
	this.as_html = () => this.array.map(el => `<td><pre>${JSON.stringify(el)}</pre></td>`).join(""); 
	this.update_debug_table = function() {
		let row = document.getElementById("current-stack");
		row.innerHTML = `<td>current</td>${this.as_html()}`
	}
	function update_on_call(f) {
		return function(...a) {
			let retval = f(...a);
			this.update_debug_table();
			return retval;
		}
	}
	this.push = update_on_call((...x) => this.array.push(...x));
	this.pop  = update_on_call(() => this.array.pop());
	this.dump = function() {
		display(this.array.join(", "));
	}
}

function add_call_info(token, state) {
	let table = document.getElementById("debug");
	let row = table.insertRow();
	row.innerHTML = `<td><pre>${token.type}(${token.payload})</pre></td>${state.stack.as_html()}`;
}

function Settings(debug, nya_delay) {
	this.debug = debug;
	this.nya_delay = nya_delay;
}

function State(stack, settings) {
	this.settings = settings;
	this.stack = stack;
}

function Token(type, payload) {
	this.type    = type    || "";
	this.payload = payload || "";
}

function Error(code) {
	this.code = code;
}

const errors = {
	type: () => debug(new Error(1))
};

function asyncsleep(t) {
	return new Promise(resolve => setInterval(resolve, t));
}


function nyaypeof(x) {
	switch (typeof(x)) {
	case "number": return "num";
	case "string": return "str";
	case "boolean": return "bool";
	case "undefined": return "void";
	case "object":
		if (x instanceof Error)
			return "err";
	default:
		display(`Error: Cannot determine the type of ${x}\n`);
	}
}


function nyaize(types, f) {
	types.reverse();
	return async function(s) {
		let invalid = false;
		let args = types.map(type => {
			switch (type) {
			case "stack": return s.stack;
			case "any":   return s.stack.pop();
			case "state": return s;
			default:
				let arg = s.stack.pop();
				let argtype = nyaypeof(arg);

				if (argtype !== type) {
					invalid = true;
				}
				return arg;
			}
		});
		if (invalid) {
			s.stack.push(errors.type());
			return;
		}
		let retval = f(...args.reverse());
		if (retval instanceof Promise)
			retval = await retval;

		if (retval instanceof Array)
			s.stack.push(...retval);
		else if (retval !== undefined)
			s.stack.push(retval);
	}
}

const binnum = ["num", "num"];
const binstr = ["str", "str"];
const binbool = ["bool", "bool"]
let functions = {
	"+":  nyaize(binnum, (a, b) => a + b),
	"-":  nyaize(binnum, (a, b) => a - b),
	"*":  nyaize(binnum, (a, b) => a * b),
	"/":  nyaize(binnum, (a, b) => a / b),
	"%":  nyaize(binnum, (a, b) => a % b),
	">":  nyaize(binnum, (a, b) => a > b),
	"<":  nyaize(binnum, (a, b) => a < b),
	"=":  nyaize(binnum, (a, b) => a == b),
	">=": nyaize(binnum, (a, b) => a >= b),
	"<=": nyaize(binnum, (a, b) => a <= b),
	".":  nyaize(binstr, (a, b) => a + b),
	"&":  nyaize(binbool,(a, b) => a && b),
	"|":  nyaize(binbool,(a, b) => a || b),
	"AwA":nyaize(["bool"], a => !a),
	"Nya":nyaize(["state", "str", "bool"], async function(s, code, cond) {
		while (cond) {
			if (nyaypeof(cond) !== "bool") {
				s.stack.push(errors.type());
				break;
			}
			await execute(code, s);
			await asyncsleep(50);
			cond = s.stack.pop();
		}
	}),
	"Nom":nyaize(["stack", "num"], function(s, n) {
		for (let i = 0; i < n + 1; i++)
			s.pop();
	}),
	"Meow": nyaize(["str"], display),
	"Myaff": nyaize(["num"], num => num.toString()),
	"Dup" :nyaize(["any"], x => [x, x]),
	"ayN": nyaize(["stack", "num"], (s, a) => Array(a).fill(null).map(_ => s.pop())),
	"Nyurr": nyaize(["str", "str"], function(code, name) {
		functions[name] = async (s) => {
			await execute(code, s);
		};
	}),
	"Nyaypeof": nyaize(["any"], nyaypeof)
};

// for debugging the interpreter (place your breakpoints here)
function debug(payload) {
	return;
}

async function run_token(token, s) {
	switch (token.type) {
	case 'n': s.stack.push(parseFloat(token.payload));                    break;
	case 's': s.stack.push(token.payload);                                break;
	case 'b': s.stack.push({"Purr": true, "HISS": false}[token.payload]); break;
	case 'f': await functions[token.payload](s);                          break;
	case 'd':
		if (s.settings.debug) {
			display(`Breakpoint ${token.payload}\nStack dump:`);
			s.stack.dump();
			display(`\n`);
		}
		break;
	case 'e': if (s.settings.debug)
		debug(token.payload);
		break;
	case 'c': break; // comment
	default: return false;
	}
	return true;

}

function tokenize(code) {
	code += " ";
	let tokens = [];
	let paren_depth = 0;
	let current_token = new Token();
	let current_mode = null;
	let whitespace = /\s/;
	/* two types of mode switching:
	   current_mode = modes.x // switches the mode to x with the next iteration
	   modes.x()              // switches the mode to x in this iteration

	   three modes:
	   none: parses types and consumes whitespace
	   simple: parses simple payloads
	   paren: parses parenthetical payloads
	*/
	let modes = {
		simple: function(c) {
			current_mode = modes.simple;
			if (whitespace.test(c)) {
				modes.none(c);
				return;
			} else if (c == "(") {
				modes.paren(c);
				return;
			}
			current_token.payload += c;
		},
		none: function(c) {
			current_mode = modes.none;
			if (whitespace.test(c)) {
				if (current_token.type != "") {
					tokens.push(current_token);
					current_token = new Token();
				}
				return;
			}
			current_token.type = c;
			current_mode = modes.simple;
		},
		paren: function(c) {
			current_mode = modes.paren;
			let internal_paren_depth = null;
			switch (c) {
			case '(':
				paren_depth++;
				if (paren_depth == 1)
					return;
				break;
			case ')':
				paren_depth--;
				if (paren_depth == 0) {
					current_mode = modes.none;
					return;
				}
				break;
			}
			current_token.payload += c;
		}


	};
	current_mode = modes.none;

	for (const c of code) {
		current_mode(c);
	}
	
	return tokens;
}

async function execute(code, state) {
	let tokens = tokenize(code);
	for (const token of tokens) {
		add_call_info(token, state);
		let valid = await run_token(token, state);
		if (!valid) {
			display(`Syntax error: Invalid type: ${token.type}\n`);
			break;
		}
	}
}
async function run() {
	let run_button = document.getElementById("run-button");
	run_button.disabled = true;
	run_button.innerHTML = "Running...";
	let stack = new Stack([]);
	let debug = document.getElementById("debug-mode").checked;
	let nya_delay = parseInt(document.getElementById("nya-delay").value);
	let settings = new Settings(debug, nya_delay);
	let state = new State(stack, document.getElementById("debug-mode").checked);
	document.getElementById("output").innerHTML = "";
	await execute(document.getElementById("code").value, state);
	//	state.stack.dump();
	run_button.disabled = false;
	run_button.innerHTML = "Nya it out!";
}

function toggle_debug() {
	document.getElementById("demeow").classList.toggle("hidden");
}
